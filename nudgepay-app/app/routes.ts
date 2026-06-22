import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("invite", "routes/invite.tsx"),
  route("accept/:token", "routes/accept.$token.tsx"),
  // Task 10 will add: dashboard, privacy, eula
] satisfies RouteConfig;
