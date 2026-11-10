import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { sendOtpSchema, verifyOtpSchema } from '../validators/auth.js';
import { sendOtpLimiter, verifyOtpLimiter } from '../middleware/rateLimiters.js';
import { postSendOtp, postVerifyOtp, postRefresh, postLogout } from '../controllers/auth.js';

export const authRouter = Router();
authRouter.post('/send-otp', sendOtpLimiter, validate(sendOtpSchema), postSendOtp);
authRouter.post('/verify-otp', verifyOtpLimiter, validate(verifyOtpSchema), postVerifyOtp);
authRouter.post('/refresh', postRefresh);
authRouter.post('/logout', postLogout);
