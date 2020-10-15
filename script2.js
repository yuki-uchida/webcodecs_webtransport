const $encoderVideo = document.querySelector(".encoder video");
const $encoderTimestamp = document.querySelector(".encoder .timestamp");
const $encoderType = document.querySelector(".encoder .type");
const $encoderByteLength = document.querySelector(".encoder .byte-length");
const $ignoreSync = document.querySelector("#ignore-sync");
const $delay = document.querySelector("#delay");
const $packetLostRatio = document.querySelector("#packet-lost-ratio");
const $prepareConnectionButton = document.querySelector(
  "#prepareConnectionButton"
);
const $getUserMediaButton = document.querySelector("#getUserMediaButton");
const $sendVideoWithDatagramButton = document.querySelector(
  "#sendVideoWithDatagramButton"
);
const $sendVideoWithBidirectionalStreamButton = document.querySelector(
  "#sendVideoWithBidirectionalStreamButton"
);

const $decoderCanvas = document.querySelector(".decoder canvas");
const ctx = $decoderCanvas.getContext("2d");

let packetLostRatio = 0.0;
let delay = 100;
let ignoreSync = false;
let seq = 0;
const checkSupported = () => {
  return !!window.VideoEncoder;
};
const supported = checkSupported();
if (!supported) {
  alert(
    [
      "Your browser does not support WebCodecs.",
      "use Chrome with M87 and enable `#enable-experimental-web-platform-features`",
      "for experiencing this experimental web app.",
    ].join(" ")
  );
}
document.querySelector("#web-codecs-supported").innerHTML = supported
  ? "yes"
  : "no";

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
  console.log("startReceivingDatagram");
  startReceivingDatagram();
  console.log("startReceivingStream");
  startReceivingStream();
  console.log("startReceivingBidirectionalStream");
  startReceivingBidirectionalStream();
  globalThis.streamNumber = 1;
  // console.log(transport);
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
    const view   = new DataView(value.buffer)
    const size   = view.getUint32(0)
    let   buffer = value.slice(4)

    while (buffer.length < size) {
      let {done, value} = await reader.read()
      buffer = new Uint8Array([...buffer, ...value])
    }

    // Encode Chunk
    const chunk   = CBOR.decode(buffer.buffer)
    const encoded = new EncodedVideoChunk(chunk)
    globalThis.decoder.decode(encoded)
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
async function startReceivingDatagram() {
  const rs = globalThis.currentTransport.receiveDatagrams();
  const reader = rs.getReader();
  while (true) {
    const { value, done } = await reader.read();
    // globalThis.decoder.decode(value);
    // let result = new TextDecoder("ascii").decode(value);
    console.log(value);
    if (done) {
      break;
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
    error: function () {
      console.error(arguments);
    },
  });
  videoDecoder.configure({
    codec: "vp8",
  });
  globalThis.decoder = videoDecoder;
};
$getUserMediaButton.onclick = prepareLocalStreamAndRemoteCanvas;

// This Function doesn't work, because of difficulity of separating datagram to limit max size(1253btyes).
const sendVideoWithDatagram = async () => {
  $sendVideoWithDatagramButton.setAttribute("disabled", "disabled");

  const [videoTrack] = $encoderVideo.srcObject.getVideoTracks();
  let reqKeyFrame = false;
  const videoEncoder = new VideoEncoder({
    output: function (chunk) {
      if (globalThis.writer) {
        writer.write(chunk.data);
        // writer.write(new Uint8Array([65, 66, 67]));
      } else {
        // console.log("bbbb");
        const ws = globalThis.currentTransport.sendDatagrams();
        const writer = ws.getWriter();
        globalThis.writer = writer;
        writer.write(chunk.data);
        // writer.write(new Uint8Array([65, 66, 67]));
      }
      // videoDecoder.decode(chunk);
    },
    error: function () {
      console.error(arguments);
    },
  });
  await videoEncoder.configure({
    codec: "vp8",
    width: 640,
    height: 480,
    framerate: 30,
  });
  console.log("make VideoTrackReader");
  const videoReader = new VideoTrackReader(videoTrack);
  let idx = 0;
  const interval = 10 * 30; // 10 sec
  videoReader.start((frame) => {
    const _reqKeyFrame = reqKeyFrame || !(idx++ % interval);
    videoEncoder.encode(frame, { keyFrame: _reqKeyFrame });
    reqKeyFrame = false;
  });
};
$sendVideoWithDatagramButton.onclick = sendVideoWithDatagram;

const sendVideoWithBidirectionalStream = async () => {
  $sendVideoWithBidirectionalStreamButton.setAttribute("disabled", "disabled");

  const [videoTrack] = $encoderVideo.srcObject.getVideoTracks();
  let reqKeyFrame = false;
  const stream = globalThis.bidirectionalStream;
  const videoEncoder = new VideoEncoder({
    output: function (chunk) {
      const { type, timestamp, duration, data } = chunk
      const encoded = new Uint8Array(CBOR.encode({
        type, timestamp, duration,
        data: new Uint8Array(data),
      }))
      const size = new Uint8Array(4)
      const view = new DataView(size.buffer)
      view.setUint32(0, encoded.length)
      console.log(type,timestamp,duration)
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
  await videoEncoder.configure({
    codec: "vp8",
    width: 640,
    height: 480,
    framerate: 30,
  });
  console.log("make VideoTrackReader");
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
