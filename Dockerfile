FROM apify/actor-node:20

COPY package.json package-lock.json* ./
RUN npm ci

COPY . ./
RUN npm run build

CMD ["npm", "start", "--silent"]

