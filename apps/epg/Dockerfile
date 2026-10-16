# EPG grabber container: iptv-org/epg checkout + channels generator + loop runner.
# Writes /data/epg/guide.xml (XMLTV) on a schedule. See README.md.
#
# Build:  docker build -t freetv-epg apps/epg
#         docker build --build-arg EPG_REF=<commit-or-branch-or-tag> apps/epg

# NODE_IMAGE is overridable for registry mirrors (e.g. a pull-through cache of Docker Hub).
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

# Upstream grabber, pinned to a tested commit (the sha is recorded in docs/notes/review-fixes-d.md).
# To bump: pick a commit on iptv-org/epg master, check it builds and grabs, then change this default
# and the EPG_REF defaults in docker-compose.yml and .env.example (all three must match).
# EPG_REF may be a full commit sha, a branch or a tag.
ARG EPG_REPO=https://github.com/iptv-org/epg.git
ARG EPG_REF=8c23cfe7396724ee5297f370415fc04d6fda058c

# Mirror of iptv-org/api used when iptv-org.github.io is unreachable (see fetch-api-data.mjs).
ENV API_MIRROR_BASE=https://raw.githubusercontent.com/iptv-org/api/gh-pages

ENV EPG_DIR=/epg \
    EPG_WORK_DIR=/work \
    EPG_OUTPUT=/data/epg/guide.xml

# Runs as the image's "node" user (uid/gid 1000), the same uid as the api and proxy images. The data
# volume is shared with the api, which creates it as node too, so there is one owner for /data.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /epg /work /data/epg /app \
 && chown -R node:node /epg /work /data

# Everything below runs as the unprivileged user, so /epg and node_modules are owned by it
# and no recursive chown layer is needed.
USER node
WORKDIR /epg

# `git clone --branch` only takes names, so fetch the ref directly. This works for a commit sha,
# a branch or a tag, and downloads only that one commit.
RUN git init --quiet /epg \
 && git -C /epg remote add origin "${EPG_REPO}" \
 && git -C /epg fetch --quiet --depth 1 origin "${EPG_REF}" \
 && git -C /epg checkout --quiet FETCH_HEAD \
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
