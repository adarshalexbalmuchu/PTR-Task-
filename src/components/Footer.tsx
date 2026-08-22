export default function Footer() {
  return (
    <footer className="border-t border-ptr-cream-dark px-4 md:px-6 py-4 mt-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-xs text-ptr-brown-light/80">
        <p>Department of Forest, Environment &amp; Climate Change &middot; Government of Jharkhand</p>
        <p>&copy; {new Date().getFullYear()} Palamau Tiger Reserve &middot; Tiger Cell &middot; Smart Forester</p>
      </div>
    </footer>
  );
}
