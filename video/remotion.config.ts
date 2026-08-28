import { Config } from "@remotion/cli/config";

/**
 * H.264 in an MP4, CRF 18.
 *
 * That codec pair is what X, Instagram and LinkedIn all accept without
 * re-encoding twice; VP9 or a WebM would be smaller and would be transcoded on
 * upload anyway, losing the advantage. CRF 18 is a notch above the default 23
 * because the frames are large flat fields of near-black with thin 1px hairlines —
 * exactly what a default bitrate turns into visible banding around the glow.
 */
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setCrf(18);

/* One scale factor above 1 would render the 1920x1080 frame at 2x and downsample,
   which sharpens hairlines. It also roughly quadruples render time, so it stays at
   1 and the composition is authored at final size instead. */
Config.setScale(1);

/* The cut carries a synthesised audio bed (public/bed.wav, see
   scripts/gen-audio.mjs), so audio is on. 192kbps AAC — the bed is a sparse
   synthesised pad with a 61Hz pulse, and the artefact a lower bitrate produces on
   that material is a warble in the sub, which is the one thing a phone speaker
   still reproduces.

   The picture is nonetheless built to work in silence, because feeds autoplay
   muted and most viewers will never hear this: no information is in the audio that
   is not on screen. */
Config.setAudioCodec("aac");
Config.setAudioBitrate("192k");

export {};
