import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Import map for Three.js and TalkingHead */}
        <script
          type="importmap"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              imports: {
                three: "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js/+esm",
                "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
                talkinghead: "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs",
              },
            }),
          }}
        />
        {/* Load TalkingHead library */}
        <script
          type="module"
          dangerouslySetInnerHTML={{
            __html: `
              import { TalkingHead } from "talkinghead";
              window.TalkingHead = TalkingHead;
              console.log("✅ TalkingHead loaded globally");
            `,
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
