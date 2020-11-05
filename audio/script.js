const $localAudio = document.querySelector("#LocalAudio")
const $remoteAudio = document.querySelector("#RemoteAudio");
const $prepareConnectionButton = document.querySelector(
  "#prepareConnectionButton"
);
const $getUserMediaButton = document.querySelector("#getUserMediaButton");
const $sendVideoWithBidirectionalStreamButton = document.querySelector(
  "#sendVideoWithBidirectionalStreamButton"
);

async function prepareConnection() {
  $prepareConnectionButton.setAttribute("disabled", "disabled");
  const url = "quic-transport://localhost:4433/webcodecs_webtransport";
  var transport = new QuicTransport(url);
  // console.log(transport);
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
  console.log("startReceivingStream");
  startReceivingStream();
  console.log("startReceivingBidirectionalStream");
  startReceivingBidirectionalStream();
  globalThis.streamNumber = 1;
}
async function startReceivingStream() {
  let reader = globalThis.currentTransport.receiveStreams().getReader();
  while (true) {
    let result = await reader.read();
    if (result.done) {
      console.log("Done accepting unidirectional streams!");
      return;
    }
    let stream = result.value;
    let number = globalThis.streamNumber++;
    readDataFromStream(stream, number);
  }
}
async function startReceivingBidirectionalStream() {
  let stream = await globalThis.currentTransport.createBidirectionalStream();
  const reader = stream.readable.getReader()
  globalThis.bidirectionalStream = stream
  while (true) {
    let {done, value} = await reader.read()
    if (done) {
      console.log("Done accepting unidirectional streams!");
      return;
    }
    console.log(value)
    // if(value[0] == 0) continue
    const view   = new DataView(value.buffer)
    let size = null
    try{
      size = view.getUint32(0)
    }catch{
      console.log('error size')
      continue
    }
    let   buffer = value.slice(4)

    while (buffer.length < size) {
      let {done, value} = await reader.read()
      buffer = new Uint8Array([...buffer, ...value])
    }

    // Encode Chunk
    try{
    const chunk   = CBOR.decode(buffer.buffer)
    const encoded = new EncodedVideoChunk(chunk)
    globalThis.decoder.decode(encoded)
    } catch {
      continue
    }
  }
}
async function readDataFromStream(stream, number) {
  let decoder = new TextDecoderStream("utf-8");
  let reader = stream.readable.pipeThrough(decoder).getReader();
  while (true) {
    let result = await reader.read();
    if (result.done) {
      console.log("Stream #" + number + " closed");
      return;
    }
    if (result.value.startsWith("quic_transport_id=")) {
      const index = result.value.indexOf("=");
      document.getElementById("QuicTransportID").value = result.value.slice(
        index + 1
      );
    } else {
      console.log(result);
    }
  }
}

async function sendStream() {
  const transport = globalThis.currentTransport;
  const stream = await transport.createSendStream();
  const writer = stream.writable.getWriter();
  const data1 = new Uint8Array([65, 66, 67]);
  writer.write(data1);
  try {
    await writer.close();
    console.log("All data has been sent.");
  } catch (error) {
    console.error(`An error occurred: ${error}`);
  }
}

//////////////////////////////////////////////////////////////////////////////

const prepareLocalStreamAndRemoteCanvas = async () => {
  $getUserMediaButton.setAttribute("disabled", "disabled");
  const localStream = await navigator.mediaDevices
    .getUserMedia({ video: false, audio: true })
    .catch((err) => {
      throw err;
    });
  $localAudio.srcObject = localStream;
  const audioDecoder = new AudioDecoder({
    output: async function (chunk) {      
      console.log(chunk)
    },
    error: function () {
      console.error(arguments);
    },
  });
  audioDecoder.configure({
    codec: "opus",
    numberOfChannels: 2,
    sampleRate: 44100
  });
  globalThis.decoder = audioDecoder;
};
$getUserMediaButton.onclick = prepareLocalStreamAndRemoteCanvas;



const sendVideoWithBidirectionalStream = async () => {
  $sendVideoWithBidirectionalStreamButton.setAttribute("disabled", "disabled");
  const [audioTrack] = $localAudio.srcObject.getAudioTracks();
  let reqKeyFrame = false;
  const stream = globalThis.bidirectionalStream;
  const audioEncoder = new AudioEncoder({
    output: function (chunk) {
      const { type, timestamp, duration, data } = chunk
      const encoded = new Uint8Array(CBOR.encode({
        type, timestamp, duration,
        data: new Uint8Array(data),
      }))
      // 4byteのバッファを作成？
      const size = new Uint8Array(4)
      // size.buffer は ArrayBuffer
      // DataBiewはバッファを作成した後、そのバッファにバイナリデータを入出力するためのオブジェクト
      // `new DataView( buffer, 128 ) ;` の場合、128byte~末尾までのバイナリを操作する
      // ArrayBufferは、固定長のバイナリデータを取り扱うための、物理メモリ領域(バッファ)を確保する機能を備えたオブジェクト
      // 内容を読み書きするには、TypedArray(Uint8Arrayなど)にするか、DataViewを作成する必要がある
      const view = new DataView(size.buffer)
      console.log(size,encoded.length)
      // setUint32で0番目にサイズを入れてる？
      view.setUint32(0, encoded.length)
      // console.log(...size)
      // console.log(...encoded)
      if (globalThis.writer) {
        writer.write(new Uint8Array([...size, ...encoded]));
        // writer.write(new Uint8Array([65, 66, 67]));
      } else {
        // console.log("bbbb");
        const writer = stream.writable.getWriter();
        globalThis.writer = writer;
        writer.write(new Uint8Array([...size, ...encoded]));
        // writer.write(new Uint8Array([65, 66, 67]));
      }
      // videoDecoder.decode(chunk);
    },
    error: function () {
      console.error(arguments);
    },
  });
  await audioEncoder.configure({
    codec: "aac",
  });
  console.log("make AudioTrackReader");
  const audioReader = new AudioTrackReader(audioTrack);
  audioReader.start((audioFrame) => {
    audioEncoder.encode(audioFrame);
  });
};

$sendVideoWithBidirectionalStreamButton.onclick = sendVideoWithBidirectionalStream;
