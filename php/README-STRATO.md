# open-qr auf Strato (oder anderem PHP-Webspace)

## Deutsch

1. **PHP-Version prüfen:** Im Strato-Kundenlogin unter *Hosting → Einstellungen → PHP-Version* mindestens **PHP 8.1** wählen (8.3 empfohlen).
2. **Zip entpacken.** Du bekommst den Ordner `open-qr/`.
3. **Hochladen:** Den *Inhalt* von `open-qr/` per SFTP/FTP in den Ordner deiner Domain laden (z. B. mit FileZilla).
   - Wichtig: Die Datei **`.htaccess`** ist versteckt. In FileZilla unter *Server → Versteckte Dateien anzeigen erzwingen* einschalten, sonst fehlt sie.
   - Ein Unterordner geht auch, z. B. `example.de/qr/`.
4. **Domain im Browser öffnen.** Der Einrichtungs-Assistent startet automatisch.
5. Admin-Konto anlegen, Datenbank wählen (SQLite = nichts einrichten), **Installieren** – fertig.

Tipps:
- SSL für die Domain aktivieren (bei Strato kostenlos), damit Logins verschlüsselt sind.
- Neu installieren: `data/config.php` löschen. Bei SQLite startet open-qr dann mit leerer Datenbank.
- Backup: den Ordner `data/` sichern (enthält Konfiguration und SQLite-Datenbank).

## English

1. Set your hosting to **PHP 8.1 or newer**.
2. Unzip, upload the *contents* of `open-qr/` to your domain's folder. Make sure the hidden **`.htaccess`** files are uploaded too.
3. Open the domain in your browser – the setup wizard starts on its own.
4. Create the admin account, pick a database (SQLite needs no setup), click **Install**.

Reinstall: delete `data/config.php`. Backup: copy the `data/` folder.
