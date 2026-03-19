// This tells the browser the service worker has installed successfully
self.addEventListener('install', (event) => {
    console.log('Service Worker installed safely.');
});

// We leave the fetch event completely empty!
// This ensures your site always pulls fresh live data from Supabase 
// instead of getting stuck loading an old, cached version of the leaderboard.
self.addEventListener('fetch', (event) => {
    return; 
});