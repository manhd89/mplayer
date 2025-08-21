const AD_PATTERNS = [
  /#EXT-X-DISCONTINUITY\n(?:#EXT-X-KEY:METHOD=NONE\n(?:.*\n){18,24})?#EXT-X-DISCONTINUITY\n|convertv7\//g,
  /#EXT-X-DISCONTINUITY\n#EXTINF:3\.920000,\n.*\n#EXTINF:0\.760000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:2\.500000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:2\.420000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:0\.780000,\n.*\n#EXTINF:1\.960000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:1\.760000,\n.*\n#EXTINF:3\.200000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:1\.360000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:0\.720000,\n.*/g
];

function dropDiscontinuityBlocks(text, min = 18, max = 24) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "#EXT-X-DISCONTINUITY") {
      let j = i + 1;
      while (j < lines.length && lines[j] !== "#EXT-X-DISCONTINUITY") j++;
      if (j < lines.length) {
        const between = lines.slice(i + 1, j);
        if (between.length >= min && between.length <= max) {
          i = j;
          continue;
        }
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

function cleanManifest(text) {
  let cleaned = dropDiscontinuityBlocks(text);
  for (const re of AD_PATTERNS) {
    cleaned = cleaned.replace(re, "");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n");
}

async function initPlayer() {
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) {
    alert("Trình duyệt không hỗ trợ Shaka Player");
    return;
  }

  const video = document.querySelector("video");
  const player = new shaka.Player(video);

  new shaka.ui.Overlay(player, document.getElementById("video-container"), video);

  player.getNetworkingEngine().registerResponseFilter((type, response) => {
    if (type !== shaka.net.NetworkingEngine.RequestType.MANIFEST) return;

    let text = "";
    try {
      text = new TextDecoder("utf-8").decode(response.data);
    } catch {
      text = String.fromCharCode.apply(null, new Uint8Array(response.data));
    }
    if (!text.startsWith("#EXTM3U")) return;

    const cleaned = cleanManifest(text);
    response.data = new TextEncoder().encode(cleaned);
  });

  const params = new URLSearchParams(window.location.search);
  const url = params.get("url") || "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
  await player.load(url);
}

document.addEventListener("DOMContentLoaded", initPlayer);
