# Weather Monitor - Database Query Page

A web-based SQL query interface for the weather-monitor-db PostgreSQL database on Render.

## Files

- **`query.html`** — Frontend SQL query page (open in browser or host statically)
- **`query-server.js`** — Node.js server that proxies SQL queries to PostgreSQL
- **`package.json`** — Dependencies (`pg`)

## Deploy query-server on Render

1. Push this folder to your GitHub repo
2. In [Render Dashboard](https://dashboard.render.com), click **New > Web Service**
3. Connect your repo and set:
   - **Root Directory:** `query_page`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add these **Environment Variables**:
   - `DATABASE_URL` — Your Render PostgreSQL internal or external connection string
   - `QUERY_PASSWORD` — A password of your choice (users must enter this to run queries)
5. Click **Create Web Service**

## Configure the frontend

Once deployed, copy your Render service URL (e.g. `https://your-query-server.onrender.com`) and update the `QUERY_URL` constant near the top of the `<script>` in `query.html`:

```js
const QUERY_URL = 'https://your-query-server.onrender.com/query';
```

Then open `query.html` directly in a browser, or host it alongside your existing dashboard.

## Local testing

```bash
cd query_page
npm install
QUERY_PASSWORD=yourpass DATABASE_URL=your_postgres_url node query-server.js
```

Then open `query.html` in a browser. The default local URL is `http://localhost:3001/query`.

## Security notes

- All queries require the correct password
- Only `SELECT` statements are allowed (enforced server-side)
- Raw PostgreSQL error details are not exposed to the client
