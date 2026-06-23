import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("invite", "routes/invite.tsx"),
  route("accept/:token", "routes/accept.$token.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("eula", "routes/eula.tsx"),
  route("api/contact-logs", "routes/api.contact-logs.tsx"),
  route("api/sms-consent", "routes/api.sms-consent.tsx"),
  route("api/qbo/connect", "routes/api.qbo.connect.tsx"),
  route("api/qbo/disconnect", "routes/api.qbo.disconnect.tsx"),
  route("api/qbo/refresh", "routes/api.qbo.refresh.tsx"),
  route("auth/qbo/callback", "routes/auth.qbo.callback.tsx"),
  route("webhooks/qbo", "routes/webhooks.qbo.tsx"),
  route("api/text/send", "routes/api.text.send.tsx"),
  route("webhooks/twilio/inbound", "routes/webhooks.twilio.inbound.tsx"),
  route("webhooks/twilio/status", "routes/webhooks.twilio.status.tsx"),
] satisfies RouteConfig;
