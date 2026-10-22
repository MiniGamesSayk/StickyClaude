# StickyClaude : image de production (contexte de build = racine du dépôt).
#   docker build -f deploy/Dockerfile -t stickyclaude .
#   docker run --rm --init -p 3000:3000 --memory 512m --cpus 1 stickyclaude
# La plateforme « games » (goldmine/deploy/platform) trouve ce fichier toute seule.

# ---- Étape 1 : construction (avec les devDependencies : vite, esbuild, typescript) ----------------
FROM node:22-alpine AS build
WORKDIR /app
# Les manifestes d'abord : la couche « npm ci » ne se refait que si les dépendances changent.
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --include=dev
COPY packages ./packages
COPY scripts ./scripts
# `npm run build` : client (budget du bundle, précompression brotli et gzip) puis serveur (un seul
# fichier, dépendances comprises). Les cartes de sources ne partent pas en production.
RUN npm run build \
 && find packages/client/dist packages/server/dist -name '*.map' -delete

# ---- Étape 2 : exécution (Node seul : aucune dépendance à installer, le serveur est empaqueté) -----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
# npm et yarn ne servent pas à l'exécution (~ 25 Mo en moins).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn*
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=320", "packages/server/dist/index.js"]
