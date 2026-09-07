/** Camera/microphone acquisition with a graceful fallback. */

/**
 * A black video track plus a silent audio track.
 *
 * If the browser blocks (or has no) camera, we still want a real MediaStream:
 * every peer connection is created with one video and one audio sender, so
 * toggling devices later is `replaceTrack` instead of a renegotiation.
 */
export function placeholderStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#131316";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  // A canvas with no repaints produces no frames, so nudge it once a second.
  window.setInterval(() => context?.fillRect(0, 0, 1, 1), 1000);

  const stream = canvas.captureStream(1);

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const [silentTrack] = destination.stream.getAudioTracks();
  silentTrack.enabled = false;
  stream.addTrack(silentTrack);

  return stream;
}

export interface LocalMedia {
  stream: MediaStream;
  hasCamera: boolean;
  hasMic: boolean;
  error?: string;
}

export async function getLocalMedia(video: boolean, audio: boolean): Promise<LocalMedia> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { stream: placeholderStream(), hasCamera: false, hasMic: false, error: "This browser cannot access media devices." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
    });
    // Fill in whichever half was refused so the sender layout stays constant.
    const placeholder = stream.getVideoTracks().length && stream.getAudioTracks().length ? null : placeholderStream();
    if (placeholder) {
      if (!stream.getVideoTracks().length) placeholder.getVideoTracks().forEach((t) => stream.addTrack(t));
      if (!stream.getAudioTracks().length) placeholder.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    return {
      stream,
      hasCamera: stream.getVideoTracks().some((track) => track.kind === "video" && track.label !== ""),
      hasMic: stream.getAudioTracks().some((track) => track.label !== ""),
    };
  } catch (caught) {
    return {
      stream: placeholderStream(),
      hasCamera: false,
      hasMic: false,
      error:
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Camera and microphone are blocked. You can still see and hear everyone else."
          : "No camera or microphone found. Joining in view-only mode.",
    };
  }
}

export async function listDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
}
