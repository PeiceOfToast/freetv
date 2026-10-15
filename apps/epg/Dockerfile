# EPG grabber container: iptv-org/epg checkout + channels generator + loop runner.
# Writes /data/epg/guide.xml (XMLTV) on a schedule. See README.md.
#
# Build:  docker build -t freetv-epg apps/epg
#         docker build --build-arg EPG_REF=<branch-or-tag> apps/epg

# NODE_IMAGE is overridable for registry mirrors (e.g. a pull-through cache of Docker Hub).
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

# Upstream grabber. EPG_REF must be a branch or tag (git clone --branch).
ARG EPG_REPO=https://github.com/iptv-org/epg.git
ARG EPG_REF=master

# Mirror of iptv-org/api used when iptv-org.github.io is unreachable (see fetch-api-data.mjs).
ENV API_MIRROR_BASE=https://raw.githubusercontent.com/iptv-org/api/gh-pages

ENV EPG_DIR=/epg \
    EPG_WORK_DIR=/work \
    EPG_OUTPUT=/data/epg/guide.xml

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/epg --shell /usr/sbin/nologin epg \
 && mkdir -p /epg /work /data/epg /app \
 && chown epg:epg /epg /work /data /data/epg

# Everything below runs as the unprivileged user, so /epg and node_modules are owned by it
# and no recursive chown layer is needed.
USER epg
WORKDIR /epg

RUN git clone --depth 1 --branch "${EPG_REF}" "${EPG_REPO}" /epg \
 && git -C /epg log -1 --format='iptv-org/epg commit %H (%s)'

# postinstall runs `npm run api:load`, which tries https://iptv-org.github.io/api. That host is
# often blocked and the SDK swallows the error, so the step below does the real download.
RUN npm install --no-audit --no-fund \
 && npm cache clean --force

COPY --chown=root:root generate-channels.mjs fetch-api-data.mjs run.mjs /app/

# Fills /epg/temp/data (what the grabber reads for logos and feed metadata) from the mirror.
# --strict: the build fails if any file cannot be downloaded.
RUN node /app/fetch-api-data.mjs --dir /epg/temp/data --strict

VOLUME /data

# tini reaps children and forwards SIGTERM to run.mjs, which stops the grabber's process group.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/run.mjs"]
