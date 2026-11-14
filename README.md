# SeaTools

Strona z aplikacjami morskimi działającymi w przeglądarce (PC, iPad, telefon), także offline.

## Struktura

```
index.html            strona główna (lista aplikacji)
sw.js                 tryb offline
manifest.webmanifest  ikona i nazwa po dodaniu do ekranu głównego
assets/               ikony strony
dp-footprint/         DP Footprint Plot
```

## Jak dodać nową aplikację

1. Utwórz nowy folder, np. `ballast-calc/`, i włóż do niego aplikację jako `index.html`, ikonę `icon.png` (512×512) oraz `manifest.webmanifest` (skopiuj z `dp-footprint/` i zmień nazwę).
2. Na końcu sekcji `<head>` aplikacji wklej:
   ```html
   <link rel="manifest" href="manifest.webmanifest">
   <script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('../sw.js',{scope:'../'}).catch(()=>{}))}</script>
   ```
3. W `index.html` dopisz wpis do listy `APPS`.
4. W `sw.js` dopisz `"ballast-calc/"`, `"ballast-calc/icon.png"` i `"ballast-calc/manifest.webmanifest"` do `PRECACHE` i zmień `VERSION` (np. `v1` na `v2`).
5. Wyślij zmiany na GitHuba. Strona zaktualizuje się po około minucie.

## Dane użytkowników

Aplikacje zapisują dane w przeglądarce (localStorage), osobno na każdym urządzeniu.
Dane zapisane wcześniej przy otwieraniu pliku z dysku nie przeniosą się same na stronę.
Przy nowych aplikacjach warto dodać eksport i import kopii zapasowej.
