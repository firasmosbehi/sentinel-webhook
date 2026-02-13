FROM apify/actor-node-playwright:20

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json* ./
RUN npm ci
RUN npx playwright install chromium

COPY . ./
RUN npm run build

CMD ["npm", "start", "--silent"]
