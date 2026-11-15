# SeaTools

Strona z aplikacjami morskimi działającymi w przeglądarce (PC, iPad, telefon), także offline.

## Struktura

```
index.html            strona główna (lista aplikacji)
sw.js                 tryb offline
manifest.webmanifest  ikona i nazwa po dodaniu do ekranu głównego
assets/               ikony strony
about/                O stronie, warunki korzystania, prywatność, wersje aplikacji
dp-footprint/         DP Footprint Plot
azimuth/              Azimuth (kalkulator nawigacyjny)
port-clearance/       Port Clearance (FAL 1–7, Maritime Declaration of Health)
dp-logbook/           DP Logbook (wpisy zdarzeń wg daty i czasu, światła HiPAP/RadaScan/CyScan, DP hours i DP days, wydruk, kopia zapasowa)
plot-to-route/        Plot to Route (współrzędne Lat/Lon lub Easting/Northing z tekstu, Worda, Excela, PDF-a → plik RTZ do ECDIS, GPX, CSV; EN / PL)
                      vendor/ – pdf.js (Apache 2.0) do czytania PDF offline
torque-wrench/        Tight & Right (moment dokręcania śrub, nakrętek i szpilek M5–M48, gwint zwykły i drobny, animowany klucz analogowy i elektroniczny, dobór nasadki: sześciokąt, imbus, Torx i napęd, instrukcja PL/EN)
```

## Jak dodać nową aplikację

1. Utwórz nowy folder, np. `ballast-calc/`, i włóż do niego aplikację jako `index.html`, ikonę `icon.png` (512×512) oraz `manifest.webmanifest` (skopiuj z `dp-footprint/` i zmień nazwę).
2. Na końcu sekcji `<head>` aplikacji wklej:
   ```html
   <link rel="manifest" href="manifest.webmanifest">
   <script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('../sw.js',{scope:'../'}).catch(()=>{}))}</script>
   <script src="../assets/stats.js" defer></script>
   ```
3. W `index.html` dopisz wpis do listy `APPS`.
4. W `sw.js` dopisz `"ballast-calc/"`, `"ballast-calc/icon.png"` i `"ballast-calc/manifest.webmanifest"` do `PRECACHE` i zmień `VERSION` (np. `v1` na `v2`).
5. Wyślij zmiany na GitHuba. Strona zaktualizuje się po około minucie.

## Dane użytkowników

Aplikacje zapisują dane w przeglądarce (localStorage), osobno na każdym urządzeniu.
Dane zapisane wcześniej przy otwieraniu pliku z dysku nie przeniosą się same na stronę.
Przy nowych aplikacjach warto dodać eksport i import kopii zapasowej.

## Licznik wejść

Anonimowy licznik (GoatCounter, bez ciasteczek) jest w `assets/stats.js`. Kod konta wpisuje się w zmiennej `CODE`. Statystyki widzi tylko właściciel po zalogowaniu do panelu GoatCounter.
