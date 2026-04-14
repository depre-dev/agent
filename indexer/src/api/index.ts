import { Hono } from "hono";
import { client, graphql } from "ponder";
import { db } from "ponder:api";
import schema from "ponder:schema";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "agent-platform-indexer",
    endpoints: ["/graphql", "/sql"]
  })
);

app.use("/graphql", graphql({ db, schema }));
app.use("/sql/*", client({ db, schema }));

export default app;
