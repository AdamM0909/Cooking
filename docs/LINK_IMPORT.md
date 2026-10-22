# Reading recipe links (optional, one-time setup)

You can always add a recipe by **copying the text of a recipe page and pasting it** into
**+ Add > Quick start**. That works on any website and needs no setup.

If you also want to **paste just a link**, the site needs a small helper. Browsers are not allowed
to open other websites directly (a rule called CORS), so the helper opens the page for you and hands
the recipe back. It is a free Cloudflare Worker, takes about 5 minutes, and runs on your own account.

## What the helper does and does not do

- It fetches the page you ask for and looks for the structured recipe data that most recipe sites
  include for Google (schema.org "Recipe"). That gives clean ingredients and steps with no guessing.
- If a page has no such data, it sends back the page's text and the app works it out as it does for
  any pasted text. Check those results more carefully.
- It does not store anything and uses no AI. It can see the web addresses you ask it to read, nothing else.
- It refuses addresses inside private networks and, once you set `ALLOWED_ORIGIN`, answers only your site.
- Some sites block automated readers. If one does, use copy and paste for that site.

## Set it up

1. Make a free account at <https://dash.cloudflare.com/sign-up> (no card needed for the free plan).
2. In the dashboard open **Workers & Pages**, choose **Create**, then **Create Worker**. Name it something
   like `our-kitchen-reader` and choose **Deploy** (it deploys a sample first, that is fine).
3. Choose **Edit code**. Delete everything in the editor, then paste in the whole contents of
   [`worker/recipe-reader.js`](../worker/recipe-reader.js) from this repository. Choose **Deploy**.
4. Lock it to your site so others cannot use it: open the Worker's **Settings > Variables and Secrets**,
   add a variable named `ALLOWED_ORIGIN` with your site's address, for example
   `https://adamm0909.github.io` (no path and no trailing slash), and deploy again.
5. Copy the Worker's address (it looks like `https://our-kitchen-reader.your-name.workers.dev`).
6. In the app open **+ Add > Quick start > Reading links: one-time setup**, paste the address, and press
   **Save address**. The address is stored in your browser only, so repeat this once on each device.

Now paste a recipe link into the Quick start box and press **Make sense of it**.

## Updating the helper

`worker/recipe-reader.js` is generated from `assets/lib.js` and `worker/handler.js`. After changing
either, run `npm run build:worker`, and paste the new file into the Worker again. The tests fail if the
generated file is out of date.

## Free plan limits

Cloudflare's free plan allows 100,000 requests a day, far more than a kitchen needs.
