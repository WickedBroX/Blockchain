import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { loadWebEnv } from "../../config/env";
import {
  checkDbPassword,
  dbFindUserByEmail,
  getDefaultPool,
  getEnvAdmin,
  safeEq,
} from "../../lib/auth";

interface LoginRequestBody {
  email?: string;
  password?: string;
}

const TOKEN_EXPIRATION = "12h";

export function createAuthRouter(loginLimiter: RateLimitRequestHandler) {
  const router = Router();

  router.post("/login", loginLimiter, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LoginRequestBody;
    const emailInput =
      typeof body.email === "string" && body.email.trim().length > 0
        ? body.email.trim()
        : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!emailInput || !password) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const normalizedEmail = emailInput.toLowerCase();

    try {
      const env = loadWebEnv();
      const pool = env.databaseUrl ? getDefaultPool() : null;

      if (pool) {
        const dbUser = await dbFindUserByEmail(pool, emailInput);

        if (dbUser && dbUser.passwordHash) {
          const passwordMatches = await checkDbPassword(password, dbUser.passwordHash);

          if (passwordMatches) {
            const token = jwt.sign(
              {
                sub: `user:${dbUser.id}`,
                email: dbUser.email,
                role: dbUser.role ?? "admin",
              },
              env.jwtSecret,
              { expiresIn: TOKEN_EXPIRATION },
            );

            res.json({
              token,
              user: {
                id: dbUser.id,
                email: dbUser.email,
                role: dbUser.role ?? "admin",
                source: "database" as const,
              },
            });
            return;
          }
        }
      }

      const envAdmin = getEnvAdmin();

      if (!envAdmin) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }

      const identifierMatches = safeEq(normalizedEmail, envAdmin.email.toLowerCase());
      let passwordMatches = false;

      if (envAdmin.password) {
        passwordMatches = safeEq(password, envAdmin.password) || passwordMatches;
      }

      if (!passwordMatches && envAdmin.passwordHash) {
        passwordMatches = await checkDbPassword(password, envAdmin.passwordHash);
      }

      if (!identifierMatches || !passwordMatches) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }

      const token = jwt.sign(
        {
          sub: "admin",
          email: envAdmin.email,
          role: "admin",
        },
        env.jwtSecret,
        { expiresIn: TOKEN_EXPIRATION },
      );

      res.json({
        token,
        user: {
          id: "env-admin",
          email: envAdmin.email,
          role: "admin",
          source: "env" as const,
        },
      });
    } catch (error) {
      console.error("failed to authenticate user", error);
      res.status(500).json({ error: "auth_failed" });
    }
  });

  return router;
}
