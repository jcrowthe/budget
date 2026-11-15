import { Link } from "react-router";

// Sorts last so every concrete page wins; the catch-all route has the lowest ranking anyway.
export const page = {
  path: "*",
  element: (
    <div className="card">
      <h2>Page not found</h2>
      <Link to="/">Go home</Link>
    </div>
  ),
};
