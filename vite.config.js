import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: ["favicon.svg", "sunpay-icon.png"],

      manifest: {
        name: "SUN PAY",
        short_name: "SUN PAY",
        description: "Personal Payment Collector",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",

        icons: [
          {
            src: "/sunpay-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/sunpay-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
