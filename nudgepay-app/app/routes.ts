import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // Tasks 8-10 will add: onboarding, invite, accept/:token, dashboard, privacy, eula
] satisfies RouteConfig;
