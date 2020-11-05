const $encoderVideo = document.querySelector('.encoder video');
const $prepareConnectionButton = document.querySelector('#prepareConnectionButton');
const $getUserMediaButton = document.querySelector('#getUserMediaButton');
const $sendVideoWithDatagramButton = document.querySelector('#sendVideoWithDatagramButton');
const $sendVideoWithBidirectionalStreamButton = document.querySelector(
  '#sendVideoWithBidirectionalStreamButton'
);

const $decoderCanvas = document.querySelector('.decoder canvas');
const ctx = $decoderCanvas.getContext('2d');
async function prepareConnection() {
  $prepareConnectionButton.setAttribute('disabled', 'disabled');
  const url = 'quic-transport://localhost:4433/webcodecs_webtransport';
  var transport = new QuicTransport(url);
  console.log(`initializing QuicTransport Instance`);
  transport.closed
    .then(() => {
      console.log(`The QUIC connection to ${url} closed gracefully`);
    })
    .catch((error) => {
      console.error(`the QUIC connection to ${url} closed due to ${error}`);
    });
  await transport.ready;
  globalThis.currentTransport = transport;
  console.log('startReceivingDatagram');
  startReceivingDatagram();
  console.log('startReceivingStream');
  startReceivingStream();
  console.log('startReceivingBidirectionalStream');
  startReceivingBidirectionalStream();
  globalThis.streamNumber = 1;
}
async function startReceivingStream() {
  let reader = globalThis.currentTransport.receiveStreams().getReader();
  while (true) {
    let result = await reader.read();
    if (result.done) {
      console.log('Done accepting unidirectional streams!');
      return;
    }
    let stream = result.value;
    let number = globalThis.streamNumber++;
    readDataFromStream(stream, number);
  }
}
async function startReceivingBidirectionalStream() {
  let stream = await globalThis.currentTransport.createBidirectionalStream();
  const reader = stream.readable.getReader();
  globalThis.bidirectionalStream = stream;
  while (true) {
    let { done, value } = await reader.read();
    if (done) {
      console.log('Done accepting unidirectional streams!');
      return;
    }
    const view = new DataView(value.buffer);
    let size = null;
    try {
      size = view.getUint32(0);
    } catch {
      console.log('error size');
      continue;
    }
    //最初の4文字は送信側で埋め込んでるからsliceで削る
    let buffer = value.slice(4);

    // bidirectional streamの場合、自動でパケット分割してるので、それを待って連結する処理
    while (buffer.length < size) {
      let { done, value } = await reader.read();
      buffer = new Uint8Array([...buffer, ...value]);
    }

    // Encode Chunk
    try {
      const chunk = CBOR.decode(buffer.buffer);
      const encoded = new EncodedVideoChunk(chunk);
      globalThis.decoder.decode(encoded);
    } catch {
      continue;
    }
  }
}
async function readDataFromStream(stream, number) {
  let decoder = new TextDecoderStream('utf-8');
  let reader = stream.readable.pipeThrough(decoder).getReader();
  while (true) {
    let result = await reader.read();
    if (result.done) {
      console.log('Stream #' + number + ' closed');
      return;
    }
    if (result.value.startsWith('quic_transport_id=')) {
      const index = result.value.indexOf('=');
      document.getElementById('QuicTransportID').value = result.value.slice(index + 1);
    } else {
      console.log(result);
    }
  }
}
async function startReceivingDatagram() {
  const rs = globalThis.currentTransport.receiveDatagrams();
  const reader = rs.getReader();
  let nowSequenceNumber = null;
  const chunkQueue = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }
    const view = new DataView(value.buffer);
    let size = null;
    try {
      size = view.getUint32(0);
    } catch {
      console.log('error size');
      continue;
    }
    let buffer = value.slice(4);
    try {
      const chunk = CBOR.decode(buffer.buffer);
      if (nowSequenceNumber == null) {
        nowSequenceNumber = chunk.sequenceNumber;
      }
      // emulate packet loss.
      // if (chunk.sequenceNumber != 0 && chunk.sequenceNumber % 500 == 0) {
      //   continue;
      // }

      if (nowSequenceNumber != chunk.sequenceNumber) {
        nowSequenceNumber = chunk.sequenceNumber;
        chunkQueue.length = 0; // flush chunk queue.
      }
      if (nowSequenceNumber == chunk.sequenceNumber) {
        // sequenceNumberが同じ時はqueueに入れてサイズが満たされているかチェックする
        chunkQueue.push(chunk);
        if (chunkQueue.length == chunk.packetSize) {
          // [{type: , timestamp: , data: ,},{},{}]みたいな形になってるので、最初のプロパティ郡と全てのdataを取り出す
          const mergedPacket = {};
          mergedPacket.type = chunkQueue[0].type;
          mergedPacket.duration = chunkQueue[0].duration;
          mergedPacket.timestamp = chunkQueue[0].timestamp;
          const mergedData = [];
          chunkQueue.forEach((p) => {
            mergedData.push(...p.data);
          });
          chunkQueue.length = 0; // flush chunk queue.
          mergedPacket.data = new Uint8Array(mergedData);
          // // ここではまだsequenceNumberやpacketSizeの情報もあるので何かしらの処理を挟んでからdecode
          // 最終的にEncodedVideochunkにしてからデコードするのは間違いない
          const chunkPacket = new EncodedVideoChunk(mergedPacket);
          globalThis.decoder.decode(chunkPacket);
        } else {
          //全てのパケット分届いていないなら待つ
          continue;
        }
      }
    } catch {
      continue;
    }
  }
}

//////////////////////////////////////////////////////////////////////////////

const prepareLocalStreamAndRemoteCanvas = async () => {
  $getUserMediaButton.setAttribute('disabled', 'disabled');
  const localStream = await navigator.mediaDevices
    .getUserMedia({ video: true, audio: false })
    .catch((err) => {
      throw err;
    });
  $encoderVideo.srcObject = localStream;
  const videoDecoder = new VideoDecoder({
    output: async function (chunk) {
      // canvas に描画
      const { codedWidth, codedHeight } = chunk;
      $decoderCanvas.width = codedWidth;
      $decoderCanvas.height = codedHeight;
      const imageBitmap = await chunk.createImageBitmap();
      ctx.drawImage(imageBitmap, 0, 0);
    },
    error: function (e) {
      console.log(e);
      console.error(arguments);
    },
  });
  videoDecoder.configure({
    codec: 'vp8',
  });
  globalThis.decoder = videoDecoder;
};
$getUserMediaButton.onclick = prepareLocalStreamAndRemoteCanvas;

const sendVideoWithDatagram = async () => {
  $sendVideoWithDatagramButton.setAttribute('disabled', 'disabled');

  const [videoTrack] = $encoderVideo.srcObject.getVideoTracks();
  let reqKeyFrame = false;

  const serializeChunk = (chunk, sequenceNumber) => {
    const { type, timestamp, duration, data } = chunk;

    const encodedPackets = [];
    let i = 0;
    const packetSize = Math.ceil(data.byteLength / 1000);
    while (i < data.byteLength) {
      const encoded = new Uint8Array(
        CBOR.encode({
          type,
          timestamp,
          duration,
          sequenceNumber,
          packetSize,
          data: new Uint8Array(data.slice(i, i + 1000)),
        })
      );
      const size = new Uint8Array(4);
      const view = new DataView(size.buffer);
      view.setUint32(0, encoded.length);

      encodedPackets.push(new Uint8Array([...size, ...encoded]));
      i += 1000;
    }
    return encodedPackets;
  };
  let sequenceNumber = 0;
  const videoEncoder = new VideoEncoder({
    output: function (chunk) {
      const encodedPackets = serializeChunk(chunk, sequenceNumber);
      if (!globalThis.writer) {
        const ws = globalThis.currentTransport.sendDatagrams();
        const writer = ws.getWriter();
        globalThis.writer = writer;
      }
      encodedPackets.forEach((encodedPacket) => writer.write(encodedPacket));
      sequenceNumber += 1;
    },
    error: function () {
      console.error(arguments);
    },
  });
  await videoEncoder.configure({
    codec: 'vp8',
    width: 640,
    height: 480,
    framerate: 30,
  });
  console.log('make VideoTrackReader');
  const videoReader = new VideoTrackReader(videoTrack);
  let idx = 0;
  const interval = 10 * 30; // 10 sec
  console.log('start videoReader');
  videoReader.start((frame) => {
    const _reqKeyFrame = reqKeyFrame || !(idx++ % interval);
    videoEncoder.encode(frame, { keyFrame: _reqKeyFrame });
    reqKeyFrame = false;
  });
};
$sendVideoWithDatagramButton.onclick = sendVideoWithDatagram;

const sendVideoWithBidirectionalStream = async () => {
  $sendVideoWithBidirectionalStreamButton.setAttribute('disabled', 'disabled');

  const [videoTrack] = $encoderVideo.srcObject.getVideoTracks();
  let reqKeyFrame = false;
  const stream = globalThis.bidirectionalStream;
  const videoEncoder = new VideoEncoder({
    output: function (chunk) {
      const { type, timestamp, duration, data } = chunk;
      const encoded = new Uint8Array(
        CBOR.encode({
          type,
          timestamp,
          duration,
          data: new Uint8Array(data),
        })
      );
      // 4byteのバッファを作成？
      const size = new Uint8Array(4);
      // size.buffer は ArrayBuffer
      // DataBiewはバッファを作成した後、そのバッファにバイナリデータを入出力するためのオブジェクト
      // `new DataView( buffer, 128 ) ;` の場合、128byte~末尾までのバイナリを操作する
      // ArrayBufferは、固定長のバイナリデータを取り扱うための、物理メモリ領域(バッファ)を確保する機能を備えたオブジェクト
      // 内容を読み書きするには、TypedArray(Uint8Arrayなど)にするか、DataViewを作成する必要がある
      const view = new DataView(size.buffer);

      view.setUint32(0, encoded.length);
      if (globalThis.writer) {
        writer.write(new Uint8Array([...size, ...encoded]));
      } else {
        const writer = stream.writable.getWriter();
        globalThis.writer = writer;
        writer.write(new Uint8Array([...size, ...encoded]));
      }
    },
    error: function () {
      console.error(arguments);
    },
  });
  await videoEncoder.configure({
    codec: 'vp8',
    width: 640,
    height: 480,
    framerate: 30,
  });
  console.log('make VideoTrackReader');
  const videoReader = new VideoTrackReader(videoTrack);
  let idx = 0;
  const interval = 10 * 30; // 10 sec
  videoReader.start((frame) => {
    const _reqKeyFrame = reqKeyFrame || !(idx++ % interval);
    videoEncoder.encode(frame, { keyFrame: _reqKeyFrame });
    reqKeyFrame = false;
  });
};

$sendVideoWithBidirectionalStreamButton.onclick = sendVideoWithBidirectionalStream;
