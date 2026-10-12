# UI delivery

## Fixed test site

**http://43.136.20.106:18790/thunder-run/**

The test site is the existing Nginx service on port 18790, separate from the official site. Build with `TR_WEB_BASE=/thunder-run/`. Every deployment completion reply must include the complete clickable test URL.

The user confirms they can access this URL and intentionally restricts access to their own IP through the firewall. Do not probe public reachability or change firewall/security-group rules. Validate the served files and UI/gameplay using the existing loopback test route; do not treat an assistant-side public timeout as a deployment failure.

## Merge and official-site gate

- Push UI changes on a feature branch and open a PR targeting `main`; do not push directly to `main` or merge on the user's behalf.
- **User instruction (2026-10-11): wait for the user to merge before synchronizing the official site.** PR creation, successful CI and test-site deployment do not authorize an early official deployment.
- After the user confirms the merge, fetch `origin/main`, identify the actual merged revision, build from that revision (not a dirty feature tree), preserve a rollback copy, and verify the official route's HTML/assets and required phone flows match it.
- Respect the same public-access restriction: no assistant-side public probe is required. Report the actual deployed revision and checks, and include the fixed test-site link.

## Phone acceptance

Follow `mobile-ui.md`. The selection page must keep the complete visible roster cards and action row together in one usable phone viewport, including browser chrome and safe areas. A scaled desktop layout, a visible footer alone, or a build success is insufficient. WX bundle validation is not physical-device/Cocos/WeChat acceptance.
