const version = "6.5.10";

export const spicyLyricsRelease = Object.freeze({
  version,
  download: "https://api.spicylyrics.org/bp/loader/grabPluginFile",
  path: `https://public.storage.spicylyrics.org/spicy-lyrics@${version}.mjs`,
  // The publisher served two startup checks with the same 6.5.10 lyrics code.
  sha256: Object.freeze([
    "703a2f8f214df136d324a151e0d17cea2831f162793eeb7c15d781461666a956",
    "69e680036ed12f3db89a7bb0ea8d97107175810fecc732051088ab3026aff34f",
  ]),
});

export function isSpicyLyrics(item) {
  return item?.kind === "extension" &&
    typeof item.repo === "string" && item.repo.toLowerCase() === "spikerko/spicy-lyrics" &&
    item.spec?.length === 1 && item.spec[0]?.role === "script" &&
    /^(?:\.\/)?builds\/spicy-lyrics\.mjs$/.test(item.spec[0].path);
}
