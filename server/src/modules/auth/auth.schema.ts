import { z } from "zod";

export const loginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;
