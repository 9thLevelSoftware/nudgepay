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
  route("api/qbo/connect", "routes/api.qbo.connect.tsx"),
  route("auth/qbo/callback", "routes/auth.qbo.callback.tsx"),
] satisfies RouteConfig;
