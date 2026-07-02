import {
	isRouteErrorResponse,
	Link,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { PublicLayout } from "./components/PublicLayout";
import { pageTitle } from "./lib/meta";

const primaryLinkClass =
	"rounded-md bg-copper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-copper/90 " +
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";
const secondaryLinkClass =
	"rounded-md border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:border-copper " +
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

export const meta: Route.MetaFunction = () => pageTitle();

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Something went wrong";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "Page not found" : "Something went wrong";
		details =
			error.status === 404
				? "The page you're looking for doesn't exist or has been moved."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<PublicLayout width="prose">
			<div className="text-center">
				<h1 className="font-display text-3xl font-semibold text-text sm:text-4xl">
					{message}
				</h1>
				<p className="mt-4 text-base text-hot" role="alert">{details}</p>
				<div className="mt-8 flex items-center justify-center gap-3">
					<Link to="/dashboard" className={primaryLinkClass}>
						Go to dashboard
					</Link>
					<Link to="/" className={secondaryLinkClass}>
						Back to home
					</Link>
				</div>
				{stack && (
					<pre className="mt-8 w-full overflow-x-auto rounded-md border border-border bg-panel p-4 text-left text-xs text-muted">
						<code>{stack}</code>
					</pre>
				)}
			</div>
		</PublicLayout>
	);
}
