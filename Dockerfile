

FROM apify/actor-node-playwright-chrome:latest
USER root
# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install


# Copy the rest of the application
COPY . ./

# Switch back to the non-root user
USER node

# Set the command to run the scraper
CMD [ "npm", "start" ]
