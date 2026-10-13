# Build with the repository root as the context.
FROM node:22-alpine AS dependencies
WORKDIR /app
COPY services/ai-worker/package.json services/ai-worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    AI_WORKER_HEALTH_HOST=0.0.0.0
WORKDIR /app
COPY --from=dependencies /app/package.json ./package.json
COPY --from=dependencies /app/node_modules ./node_modules
COPY services/ai-worker/*.ts ./services/ai-worker/
COPY supabase/functions/ai-generation-worker ./supabase/functions/ai-generation-worker
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY lib/domain ./lib/domain
COPY lib/supabase/database.types.ts ./lib/supabase/database.types.ts
USER node
EXPOSE 8790
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=600s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.AI_WORKER_HEALTH_PORT||8790)+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Run Node directly as PID 1 so SIGTERM reaches the queue worker.
CMD ["node", "--experimental-strip-types", "services/ai-worker/index.ts"]
