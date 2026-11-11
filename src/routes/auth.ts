import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { sendOtpSchema, verifyOtpSchema, firebaseVerifySchema, emailSignupSchema, emailSigninSchema } from '../validators/auth.js';
import { sendOtpLimiter, verifyOtpLimiter } from '../middleware/rateLimiters.js';
import { postSendOtp, postVerifyOtp, postRefresh, postLogout, postFirebaseVerify, postEmailSignup, postEmailSignin } from '../controllers/auth.js';

export const authRouter = Router();
authRouter.post('/send-otp', sendOtpLimiter, validate(sendOtpSchema), postSendOtp);
authRouter.post('/verify-otp', verifyOtpLimiter, validate(verifyOtpSchema), postVerifyOtp);
authRouter.post('/firebase-verify', verifyOtpLimiter, validate(firebaseVerifySchema), postFirebaseVerify);
authRouter.post('/email/signup', sendOtpLimiter, validate(emailSignupSchema), postEmailSignup);
authRouter.post('/email/signin', verifyOtpLimiter, validate(emailSigninSchema), postEmailSignin);
authRouter.post('/refresh', postRefresh);
authRouter.post('/logout', postLogout);
