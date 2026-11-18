-- Preserve the existing equal proportions while representing weights as percentages.
UPDATE "Project" SET "weights" = '{"code":25,"pullRequests":25,"reviews":25,"issues":25}'::jsonb
WHERE "weights" = '{"code":1,"pullRequests":1,"reviews":1,"issues":1}'::jsonb;
