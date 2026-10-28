# FiiViu – structură juridică pentru România

Acest director conține textele juridice de lucru pentru versiunea românească a platformei.

## Date confirmate
- Operator: FiiViu S.R.L.
- Sediu: București, Piața Unirii, România
- E-mail: info@fiiviu.ro
- Model: platformă de intermediere
- Furnizorul experienței este responsabil pentru executarea serviciului
- Plata: integrală la rezervare
- Monede: EUR și RON
- Clienți: persoane fizice / B2C
- Servicii inițiale: tururi, food tours, karting, wellness/massage, nightlife/clubs, plimbări cu barca, excursii de o zi și transferuri aeroportuale individuale
- Nu se vând pachete sau combinații de servicii într-o singură rezervare.

## Date încă necesare înainte de publicarea finală
- CUI
- numărul Registrului Comerțului
- adresa juridică completă (stradă, număr, sector, cod poștal)
- statut TVA
- datele juridice ale fiecărui furnizor, acolo unde sunt necesare în oferta concretă

Textele nu trebuie considerate aviz juridic individual. Înainte de lansarea comercială, datele societății și modelul contractual trebuie verificate de un avocat/consultant fiscal din România.

## Status de verificare – 28 octombrie 2026

**Nu este aprobat pentru lansare comercială.** Proprietarul a confirmat: contractul pentru experiență se încheie cu furnizorul; furnizorii sunt comercianți; plățile utilizează Stripe Connect; FiiViu gestionează solicitările și inițierea rambursărilor. Aceste informații trebuie confirmate în configurația Stripe și în contractele efective. CUI, numărul ONRC, adresa juridică completă și statutul TVA rămân neconfirmate.

- Codul tehnic folosește un PaymentIntent în fluxul platformei și asociază contul Connect al furnizorului în metadate; registrul de decontare este separat. Acest lucru nu stabilește singur cine este comerciantul juridic, cine emite documentele fiscale sau cine suportă riscul disputelor.
- Pagina juridică salvează limba în localStorage sub cheia `fiiviu_language`; politica privind cookie-urile a fost actualizată pentru a descrie această stocare și pentru a cere verificare în producție.
- Worker-ul configurează EmailJS pentru e-mailurile operaționale. Trebuie verificat dacă există și alți furnizori activi în producție.
- Termenele exacte de păstrare a datelor trebuie stabilite pe categorii și aliniate cu obligațiile fiscale/contabile și termenele de prescripție.
- Politica de anulare spune explicit că regulile trebuie configurate per experiență; fiecare ofertă trebuie să afișeze condițiile înainte de plată și să corespundă logicii tehnice de anulare.

Nu estimați datele oficiale. Documentele și fluxurile trebuie verificate de un avocat român și de un consultant fiscal înainte de a fi declarate finale.
