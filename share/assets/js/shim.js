
if (!navigator.getUserMedia) {
  navigator.getUserMedia = (
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia
  );
}

if (!window.RTCPeerConnection) {
  window.RTCPeerConnection = (
    window.webkitRTCPeerConnection ||
    window.mozRTCPeerConnection ||
    window.msRTCPeerConnection
  );
}

if (!window.RTCSessionDescription) {
  window.RTCSessionDescription = (
    window.webkitRTCSessionDescription ||
    window.mozRTCSessionDescription ||
    window.msRTCSessionDescription
  );
}

if (!window.RTCIceCandidate) {
  window.RTCIceCandidate = (
    window.webkitRTCIceCandidate ||
    window.mozRTCIceCandidate ||
    window.msRTCIceCandidate
  );
}
