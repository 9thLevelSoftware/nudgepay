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
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./app.css";
import { PublicLayout } from "./components/PublicLayout";
import { pageTitle } from "./lib/meta";
import { THEME_BOOTSTRAP_SCRIPT } from "./components/ThemeToggle";

const primaryLinkClass =
	"rounded-md bg-copper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-copper/90 " +
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";
const secondaryLinkClass =
	"rounded-md border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:border-copper " +
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

export const meta: Route.MetaFunction = () => pageTitle();

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<Meta />
				<Links />
				<script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
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
