import { Link } from "react-router-dom";

export function LandingPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "linear-gradient(rgba(248,250,252,0.88), rgba(248,250,252,0.92)), url('https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1600&q=80')",
        }}
      />
      <div className="relative z-10 max-w-2xl px-1 text-center">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-green-700">
          SM Services
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
          Launch Your Career with the Right Internship and HR support
        </h1>
        <p className="mt-4 text-base text-slate-600 sm:text-lg">
          Build experience, gain industry exposure, and grow professionally with our curated
          programs. One login for HR, Trainer, Intern, and College.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            to="/login"
            className="rounded-lg bg-green-600 px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-green-700"
          >
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
