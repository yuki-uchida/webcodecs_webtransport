const $encoderVideo = document.querySelector(".encoder video");
const $encoderTimestamp = document.querySelector(".encoder .timestamp");
const $encoderType = document.querySelector(".encoder .type");
const $encoderByteLength = document.querySelector(".encoder .byte-length");

const $ignoreSync = document.querySelector("#ignore-sync");
const $delay = document.querySelector("#delay");
const $packetLostRatio = document.querySelector("#packet-lost-ratio");
const $startButton = document.querySelector("#start");

const $decoderCanvas = document.querySelector(".decoder canvas");
const ctx = $decoderCanvas.getContext("2d");

let packetLostRatio = 0.0;
let delay = 100;
let ignoreSync = false;
let seq = 0;
const checkSupported = () => {
  return !!window.VideoEncoder;
};

// async function prepareConnection() {
//   const url = "quic-transport://localhost:4433/webcodecs_webtransport";
//   var transport = new QuicTransport(url);
//   // console.log(transport);
//   console.log(`initializing QuicTransport Instance`);
//   transport.closed
//     .then(() => {
//       console.log(`The QUIC connection to ${url} closed gracefully`);
//     })
//     .catch((error) => {
//       console.error(`the QUIC connection to ${url} closed due to ${error}`);
//     });
//   await transport.ready;
//   console.log("startReceivingDatagram");
//   startReceivingDatagram(transport);
//   console.log("startReceivingStream");
//   startReceivingStream(transport);
//   globalThis.currentTransport = transport;
//   globalThis.streamNumber = 1;
//   // console.log(transport);
// }
// async function startReceivingStream(transport) {
//   let reader = transport.receiveStreams().getReader();
//   while (true) {
//     let result = await reader.read();
//     if (result.done) {
//       console.log("Done accepting unidirectional streams!");
//       return;
//     }
//     let stream = result.value;
//     let number = globalThis.streamNumber++;
//     readDataFromStream(stream, number);
//   }
// }
// async function readDataFromStream(stream, number) {
//   let decoder = new TextDecoderStream("utf-8");
//   let reader = stream.readable.pipeThrough(decoder).getReader();
//   while (true) {
//     let result = await reader.read();
//     if (result.done) {
//       console.log("Stream #" + number + " closed");
//       return;
//     }
//     if (result.value.startsWith("quic_transport_id=")) {
//       const index = result.value.indexOf("=");
//       document.getElementById("QuicTransportID").value = result.value.slice(
//         index + 1
//       );
//     }
//   }
// }
// async function startReceivingDatagram(transport) {
//   const rs = transport.receiveDatagrams();
//   const reader = rs.getReader();
//   while (true) {
//     const { value, done } = await reader.read();
//     let result = new TextDecoder("ascii").decode(value);
//     console.log(result);
//     if (done) {
//       break;
//     }
//   }
// }
//////////////////////////////////////////////////////////////////////////////
const run = async () => {
  $startButton.setAttribute("disabled", "disabled");

  const localStream = await navigator.mediaDevices
    .getUserMedia({ video: true, audio: false })
    .catch((err) => {
      throw err;
    });
  $encoderVideo.srcObject = localStream;
  const [videoTrack] = localStream.getVideoTracks();
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
  let reqKeyFrame = false;
  const videoEncoder = new VideoEncoder({
    output: function (chunk) {
      // if (globalThis.writer) {
      //   console.log("write");
      //   writer.write(chunk);
      // } else {
      //   const ws = globalThis.currentTransport.sendDatagrams();
      //   const writer = ws.getWriter();
      //   globalThis.writer = writer;
      //   writer.write(chunk);
      // }
      videoDecoder.decode(chunk);
      console.log(chunk);
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
  // videoReader.start((videoFrame) => {
  //   console.log("video reader");
  //   // videoEncoder.encode(videoFrame);
  // });
  let idx = 0;
  const interval = 10 * 30; // 10 sec
  videoReader.start((frame) => {
    const _reqKeyFrame = reqKeyFrame || !(idx++ % interval);
    videoEncoder.encode(frame, { keyFrame: _reqKeyFrame });
    reqKeyFrame = false;
  });
};

const supported = checkSupported();
document.querySelector("#web-codecs-supported").innerHTML = supported
  ? "yes"
  : "no";
$startButton.onclick = run;

if (!supported) {
  alert(
    [
      "Your browser does not support WebCodecs.",
      "use Chrome with M87 and enable `#enable-experimental-web-platform-features`",
      "for experiencing this experimental web app.",
    ].join(" ")
  );
}
