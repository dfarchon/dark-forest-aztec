/**
 * External URLs used across the client.
 * Prefer importing from here instead of duplicating strings in components.
 */
export const externalLinks = {
  dfArchon: {
    /** Footer “email” link (legacy contact). */
    email: "mailto:dfarchon@gmail.com",
    twitter: "https://x.com/DFArchon",
    blog: "https://onchainreality.xyz/blog",
    discord: "https://discord.gg/WGrBje23",
    github: "https://github.com/dfarchon",
    wiki: "https://dfwiki.net/wiki/Main_Page",
    plugins: "https://dfares-plugins.netlify.app/",
  },

  /** Upstream Dark Forest / zkga references (docs, legacy community). */
  darkForest: {
    communityDiscord: "https://discord.gg/WGrBje23",
    valhalla: "https://valhalla.zkga.me",
    zkgaMe: "https://zkga.me",
    twitterIntentTweet: "https://twitter.com/intent/tweet",
    pluginsRepo: "https://github.com/darkforest-eth/plugins",
    clientGameManagerDocs:
      "https://github.com/darkforest-eth/client/blob/master/docs/classes/Backend_GameLogic_GameManager.default.md",
    clientGameUIManagerDocs:
      "https://github.com/darkforest-eth/client/blob/master/docs/classes/Backend_GameLogic_GameUIManager.default.md",
    blog: {
      faq04: "https://blog.zkga.me/df-04-faq",
      hostingCommunityRound:
        "https://blog.zkga.me/hosting-a-dark-forest-community-round",
      rendererPluginContest: "https://blog.zkga.me/renderer-plugin-contest",
      introducingLobbies:
        "https://blog.zkga.me/introducing-dark-forest-lobbies",
      v3Rules: "https://blog.zkga.me/v3-rules",
      v4Recap: "https://blog.zkga.me/v4-recap",
      v5Winners: "https://blog.zkga.me/v5-winners",
      v6R1Wrapup: "https://blog.zkga.me/v6-r1-wrapup",
      v6R2Wrapup: "https://blog.zkga.me/v6-r2-wrapup",
      v6R3Wrapup: "https://blog.zkga.me/v6-r3-wrapup",
      v6R4Wrapup: "https://blog.zkga.me/v6-r4-wrapup",
      v6R5Wrapup: "https://blog.zkga.me/v6-r5-wrapup",
    },
    pluginsRepoAnchors: {
      addingPlugin:
        "https://github.com/darkforest-eth/plugins#adding-your-plugin",
      reviewerGuidelines:
        "https://github.com/darkforest-eth/plugins#reviewer-guidelines",
    },
    hiring: {
      applicantForm:
        "https://docs.google.com/forms/d/e/1FAIpQLSdaWvjxX4TrDDLidPXtgk6UW3rC082rpvi3AIPkCPxAahg_rg/viewform?usp=sf_link",
      referralForm:
        "https://docs.google.com/forms/d/e/1FAIpQLScku_bQDbkPqpHrwBzOBfQ4SV6Nw6Tgxi6zWQL8Bb0olyBE3w/viewform?usp=sf_link",
      notion:
        "https://ivanchub.notion.site/Dark-Forest-is-Hiring-ad1f0cbe816640fb9b4c663dacaaca04",
    },
  },
  aztecMainnet: {
    /** Official Aztec mainnet Ethereum ↔ Aztec bridge (Shield). */
    feeJuiceBridge: "https://df-aztec-bridge-api.vercel.app",
  },
} as const;

export type ExternalLinks = typeof externalLinks;

/** Shorthand for DFArchon footer / help — same shape as the old local `links` object. */
export const dfArchonLinks = externalLinks.dfArchon;
