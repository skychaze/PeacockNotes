# Google OAuth production and hosting research for Peacock Notes

Research date: 2026-09-16

## Verdict

Peacock Notes can keep testing Google Drive authorization without owning a domain. Put the OAuth app in Testing, add the required Google accounts as test users, and accept the tester warning and seven-day authorization lifetime. Google documents a limit of up to 100 test users for this mode. [Google Cloud: Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en) [Google Cloud: When verification is not needed](https://support.google.com/cloud/answer/13464323?hl=en)

A public production launch for any Google account needs a publicly accessible homepage on a verified domain under the developer's ownership. The homepage must describe Peacock Notes, link to the privacy policy and terms of service, and use the same privacy-policy URL that is entered in Google Auth Platform. The privacy policy must be hosted in the homepage's domain and explain how Google user data is accessed, used, stored, and shared. [Google OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies) [Google Cloud: Manage OAuth app branding](https://support.google.com/cloud/answer/15549049?hl=en)

Therefore, a Firebase, GitHub Pages, Cloudflare Pages, Vercel, or Netlify subdomain is useful for a temporary page or testing, but it does not by itself solve production OAuth domain verification. This is an inference from Google's ownership requirement and each provider's documentation identifying those URLs as provider-controlled default subdomains. Buying or otherwise controlling a domain is the reliable production path. No Cloud Console changes were made for this research.

## Requirements that apply to Peacock Notes

### Production branding and policy links

- External production apps need the homepage, privacy policy, and terms of service links before they can be submitted for verification. Google will not accept a verification submission with those links missing. [Manage OAuth app branding](https://support.google.com/cloud/answer/15549049?hl=en)
- The homepage must be publicly reachable without login, accurately identify the app or brand, describe its functionality, and link to the privacy policy. Google also requires the consent-screen homepage URL to be static and not redirect to another domain. [App homepage requirements](https://support.google.com/cloud/answer/13807376?hl=en)
- Every domain used by the homepage, privacy policy, terms, redirect URI, or JavaScript origin must be registered as an authorized domain first. A project owner or editor must verify ownership of each authorized domain in Google Search Console. [Manage OAuth app branding](https://support.google.com/cloud/answer/15549049?hl=en) [Verification requirements](https://support.google.com/cloud/answer/13464321?hl=en)
- Google Search Console supports URL-prefix verification using an HTML file or meta tag, but the person doing it still needs control of the site. Domain-property verification requires DNS control. [Search Console ownership verification](https://support.google.com/webmasters/answer/9008080?hl=en)

### Scope classification

The current Android code requests `https://www.googleapis.com/auth/drive.file`. Google classifies `drive.file` as non-sensitive. It grants access only to Drive files that the user opens with or shares with the app, so it avoids the restricted-scope review and security assessment associated with broad Drive access. A public app using it still needs the basic OAuth app verification and production branding requirements. [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) [Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)

### Testing mode

Testing is suitable for development, personal use, or a small known group. Google limits the configured test-user list to 100 users, shows an unverified-app warning, and expires each test user's authorization seven days after consent. This is not a public launch path. [Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en) [When verification is not needed](https://support.google.com/cloud/answer/13464323?hl=en)

## Hosting options

| Host | Free public URL and relevant capability | Google production fit without a domain | Assessment |
| --- | --- | --- | --- |
| Firebase Hosting | `PROJECT_ID.web.app` and `PROJECT_ID.firebaseapp.com`; SSL is enabled by default and the Firebase subdomains are available at no cost. [Firebase Hosting quickstart](https://firebase.google.com/docs/hosting/quickstart) | No reliable fit. The URL is a Firebase project subdomain, not a domain Peacock Notes owns and can verify. | Best choice after adding a custom domain, especially if the project already uses Firebase. Static hosting has a no-cost quota, but usage limits still apply. [Firebase Hosting pricing](https://firebase.google.com/pricing) |
| GitHub Pages | Static HTML, CSS, and JavaScript from a public repository on GitHub Free. User and project sites use `owner.github.io` URLs, and HTTPS is automatic for `github.io` sites. [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https) | No reliable fit using `github.io` alone. GitHub documents custom domains as domains the user owns, which is the route compatible with Google's requirement. | Good for a simple landing page and privacy policy if the repository can be public. Use a controlled custom domain for OAuth production. [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) |
| Cloudflare Pages | Static asset requests are free and unlimited. The service provides `pages.dev` subdomains and allows custom domains; the Free plan has a 500-deploy monthly limit. [Cloudflare Pages overview](https://developers.cloudflare.com/pages/) [Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/) [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) | No using `pages.dev` alone. A custom domain requires control of the apex zone or DNS for the subdomain. | Strong free static-hosting option. The hosting choice does not remove Google's domain-ownership requirement. |
| Vercel | Deployments receive a public `vercel.app` URL. Custom domains require adding and configuring a domain. [Vercel domains](https://vercel.com/docs/domains/working-with-domains) [Vercel custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain) | No using `vercel.app` alone. | Technically suitable after adding a domain. The free Hobby plan is restricted by Vercel's terms to personal or non-commercial use and may be removed without notice, so it is a poor default for a public product launch unless that restriction is acceptable. [Vercel Terms of Service](https://vercel.com/legal/terms) |
| Netlify | Every project gets a public `project.netlify.app` URL and free HTTPS. Netlify's current Free plan is $0 with hard monthly usage limits and supports custom domains with SSL. [Netlify project URLs](https://docs.netlify.com/manage/projects/how-projects-work/) [Netlify HTTPS](https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/) [Netlify pricing](https://www.netlify.com/pricing/) | No using `netlify.app` alone. | Good for a static page after adding a controlled domain. Keep the free-plan credit limit in mind because the site can pause when the limit is reached. |

## Recommended path

1. For current development, stay in Testing and use a provider subdomain if a public informational page is useful. Do not treat that page as production OAuth compliance.
2. Buy or otherwise obtain a domain that Priyanshu can verify in Search Console. The domain can point to Firebase Hosting, GitHub Pages, Cloudflare Pages, Vercel, or Netlify. Google cares about verifiable ownership and the page contents, not which static host serves the files.
3. Host the homepage and privacy policy on the same controlled domain. Keep the homepage static, public, and free of login gates. Link the privacy policy and terms of service from the homepage.
4. Register the controlled domain as an authorized domain, verify it in Search Console using an account that is also a Cloud project owner or editor, then enter the final HTTPS URLs in Google Auth Platform.
5. Submit the production app for the basic verification associated with `drive.file`, if Google requests it. Keep the declared scopes identical to the scopes requested by the Android binary.

The lowest-complexity production setup is a small custom domain plus a static site on Firebase Hosting or GitHub Pages. Cloudflare Pages is equally valid if its deployment workflow is more convenient. Hosting alone cannot replace domain ownership.
