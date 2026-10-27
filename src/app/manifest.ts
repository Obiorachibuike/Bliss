import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bliss",
    short_name: "Bliss",
    description:
      "Bliss — an all-in-one AI workspace for chat, image generation, image editing and image-to-video.",
    start_url: "/",
    display: "standalone",
    background_color: "#080D18",
    theme_color: "#2563EB",
    icons: [
      {
        src: "/bliss-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
