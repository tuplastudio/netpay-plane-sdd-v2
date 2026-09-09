import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { RequestContext } from "../context/request-context.js";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction): void => {
    const id = (req.headers["x-request-id"] as string) ?? randomUUID();
    res.setHeader("x-request-id", id);
    RequestContext.run(
      () => {
        RequestContext.setRequestId(id);
        next();
      },
      { requestId: id },
    );
  };
}