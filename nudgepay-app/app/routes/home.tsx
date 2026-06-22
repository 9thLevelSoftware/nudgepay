import { Link } from "react-router";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "64px auto", fontFamily: "sans-serif" }}>
      <h1>NudgePay</h1>
      <p>AR collections for QuickBooks users.</p>
      <p><Link to="/signup">Sign up</Link> · <Link to="/login">Log in</Link></p>
      <p style={{ marginTop: 40, fontSize: 12 }}>
        <Link to="/privacy">Privacy Policy</Link> · <Link to="/eula">EULA</Link>
      </p>
    </main>
  );
}
