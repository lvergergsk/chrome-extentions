# Publishing Chrome Extensions

Notes for publishing an extension from this repository to the Chrome Web Store.

## Official Entry Points

- [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
- [Register your developer account](https://developer.chrome.com/docs/webstore/register)
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies)

## One-Time Account Setup

1. Open the [developer registration page](https://chrome.google.com/webstore/devconsole/register).
2. Sign in with the Google account that should own the publisher.
3. Register as a Chrome Web Store developer.
4. Pay the one-time registration fee.
5. Finish the developer account profile in the Developer Dashboard.

Choose the owner account carefully. Publisher/account ownership is harder to change later than ordinary repo settings.

## Before Packaging

For each extension you plan to publish:

1. Keep only files needed by the browser in the extension folder.
2. Remove local-only development code from the package.
3. Use the minimum permissions and host permissions needed.
4. Add store-ready icons and screenshots.
5. Check that `manifest.json` is valid JSON with no comments.
6. Increase the extension `version` for every update.

For example, the current `utils` extension includes a localhost API demo. That is useful for development, but a public extension should not request localhost host permissions unless that is truly part of the product.

## Package A Folder

The Chrome Web Store upload expects a ZIP where `manifest.json` is at the ZIP root, not inside an extra folder.

From this repo:

```bash
cd utils
zip -r ../utils.zip . -x '*.DS_Store' -x 'dev/*'
```

Then upload `utils.zip` in the Developer Dashboard.

## First Publish Checklist

1. Open the Developer Dashboard.
2. Create a new item.
3. Upload the ZIP package.
4. Complete the Store listing tab.
5. Complete the Privacy practices tab.
6. Declare payment and visibility settings.
7. Provide test instructions if the extension needs login, special setup, or a test account.
8. Submit for review.
9. Watch the item status in the Developer Dashboard.

## Store Listing Assets

Prepare these before submitting:

- Extension name
- Short description
- Detailed description
- Category
- Language
- 128x128 PNG icon
- Screenshots
- Privacy policy URL if the extension handles user data
- Support/contact URL or email
- Test instructions for reviewers when needed

## Updates

For updates:

1. Increase `version` in `manifest.json`.
2. Build a new ZIP with all required extension files.
3. Upload the new ZIP to the existing item.
4. Update listing or privacy fields if behavior changed.
5. Submit the update for review.

## Automation Later

Manual dashboard publishing is simplest at first. Later, use the [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) to upload and publish from CI.
