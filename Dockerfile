FROM node:14.16.0-alpine3.13

# Get tini to handle proper process closing signals with node.
RUN apk add --no-cache tini

COPY dist/bundle.js bundle.js

ENTRYPOINT ["/sbin/tini", "node", "bundle.js"]
CMD ["--help"]
