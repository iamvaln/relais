const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { time }        = require("@nomicfoundation/hardhat-network-helpers");

// ─── Constantes de test ───────────────────────────────────────────────────────

const DAY     = 86_400;
const WEEK    = 7  * DAY;
const MONTH_3 = 90 * DAY;   // silence_duration 3 mois (défaut DEC-22)
const MONTH_1 = 30 * DAY;
const FREQ_30 = 30 * DAY;   // check-in mensuel

// Faux hash SHA256 (32 bytes) pour les tests
const HASH_K1 = ethers.keccak256(ethers.toUtf8Bytes("share_k1_contact0"));
const HASH_K2 = ethers.keccak256(ethers.toUtf8Bytes("share_k2_contact0"));
const HASH_K3 = ethers.keccak256(ethers.toUtf8Bytes("share_k3_contact1"));
const NOTIF_0 = ethers.keccak256(ethers.toUtf8Bytes("notif_contact0"));
const NOTIF_1 = ethers.keccak256(ethers.toUtf8Bytes("notif_contact1"));
const PK_HIGH = ethers.keccak256(ethers.toUtf8Bytes("ed25519_pk_high_16bytes"));
const PK_LOW  = ethers.keccak256(ethers.toUtf8Bytes("ed25519_pk_low_16bytes"));
const VAULT   = ethers.keccak256(ethers.toUtf8Bytes("storj://relais/vault/owner"));

// ─── Helper ───────────────────────────────────────────────────────────────────

async function deploy() {
  const [owner, contact1, contact2, other] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("RelaisDeadManSwitch");
  const dms = await Factory.deploy();
  return { dms, owner, contact1, contact2, other };
}

async function registerDefault(dms, signer, opts = {}) {
  return dms.connect(signer).register(
    opts.silence ?? MONTH_3,
    opts.freq    ?? FREQ_30,
    opts.n       ?? 2,
    opts.m       ?? 2,
    opts.pkH     ?? PK_HIGH,
    opts.pkL     ?? PK_LOW,
    opts.vault   ?? VAULT
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RelaisDeadManSwitch", function () {

  // ─── Déploiement ──────────────────────────────────────────────────────────

  describe("Déploiement", function () {
    it("deploie sans erreur", async function () {
      const { dms } = await deploy();
      expect(await dms.PAUSE_MAX_SECS()).to.equal(MONTH_3);
      expect(await dms.MAX_CONTACTS()).to.equal(5);
    });
  });

  // ─── register() ───────────────────────────────────────────────────────────

  describe("register()", function () {
    it("enregistre un DMS 2-of-2 avec succès", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner))
        .to.emit(dms, "DmsRegistered")
        .withArgs(owner.address, MONTH_3, 2, 2, await time.latest() + 1);

      const cfg = await dms.configs(owner.address);
      expect(cfg.status).to.equal(1); // Active
      expect(cfg.schemaN).to.equal(2);
      expect(cfg.schemaM).to.equal(2);
      expect(cfg.silenceDurationSecs).to.equal(MONTH_3);
    });

    it("émet Ed25519PkRegistered avec les bons bytes", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner))
        .to.emit(dms, "Ed25519PkRegistered")
        .withArgs(owner.address, PK_HIGH, PK_LOW);

      const [high, low] = await dms.getEd25519Pk(owner.address);
      expect(high).to.equal(PK_HIGH);
      expect(low).to.equal(PK_LOW);
    });

    it("émet CheckinRecorded au register", async function () {
      const { dms, owner } = await deploy();
      const tx = await registerDefault(dms, owner);
      const ts = (await tx.getBlock()).timestamp;
      const events = await dms.queryFilter(dms.filters.CheckinRecorded(), tx.blockNumber);
      expect(events).to.have.length(1);
      expect(events[0].args.checkinAt).to.equal(ts);
      expect(events[0].args.nextDueAt).to.equal(ts + FREQ_30);
    });

    it("refuse silenceDuration = 0", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner, { silence: 0 }))
        .to.be.revertedWithCustomError(dms, "InvalidConfig");
    });

    it("refuse N > M", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner, { n: 3, m: 2 }))
        .to.be.revertedWithCustomError(dms, "InvalidConfig");
    });

    it("refuse M < 2 (minimum 2 contacts)", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner, { n: 1, m: 1 }))
        .to.be.revertedWithCustomError(dms, "InvalidConfig");
    });

    it("refuse M > MAX_CONTACTS (5)", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner, { n: 3, m: 6 }))
        .to.be.revertedWithCustomError(dms, "InvalidConfig");
    });

    it("autorise la mise à jour d'un DMS actif", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      // Reconfiguration (ex: changement de contacts)
      await expect(registerDefault(dms, owner, { silence: MONTH_1, n: 2, m: 3 }))
        .to.emit(dms, "DmsRegistered");
      const cfg = await dms.configs(owner.address);
      expect(cfg.schemaM).to.equal(3);
    });

    it("refuse register() sur un DMS Triggered", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).markTriggered();
      await expect(registerDefault(dms, owner))
        .to.be.revertedWithCustomError(dms, "AlreadyTriggered");
    });

    it("refuse register() sur un DMS Completed", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).markTriggered();
      await dms.connect(owner).markCompleted();
      await expect(registerDefault(dms, owner))
        .to.be.revertedWithCustomError(dms, "AlreadyCompleted");
    });

    it("accepte le schéma 3-of-5", async function () {
      const { dms, owner } = await deploy();
      await expect(registerDefault(dms, owner, { n: 3, m: 5 }))
        .to.emit(dms, "DmsRegistered");
    });
  });

  // ─── setContactHashes() ───────────────────────────────────────────────────

  describe("setContactHashes()", function () {
    it("enregistre les hash des parts Shamir", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);

      await expect(
        dms.connect(owner).setContactHashes(0, HASH_K1, HASH_K2, ethers.ZeroHash, NOTIF_0)
      )
        .to.emit(dms, "ShareHashSet").withArgs(owner.address, 0, 0, HASH_K1)
        .to.emit(dms, "ShareHashSet").withArgs(owner.address, 0, 1, HASH_K2)
        .to.emit(dms, "NotificationHashSet").withArgs(owner.address, 0, NOTIF_0);

      expect(await dms.shareHashes(owner.address, 0, 0)).to.equal(HASH_K1);
      expect(await dms.shareHashes(owner.address, 0, 1)).to.equal(HASH_K2);
      expect(await dms.shareHashes(owner.address, 0, 2)).to.equal(ethers.ZeroHash);
      expect(await dms.notificationHashes(owner.address, 0)).to.equal(NOTIF_0);
    });

    it("refuse si contactIndex >= schemaM", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner); // schemaM = 2
      await expect(
        dms.connect(owner).setContactHashes(2, HASH_K1, ethers.ZeroHash, ethers.ZeroHash, NOTIF_0)
      ).to.be.revertedWithCustomError(dms, "ContactIndexOutOfRange");
    });

    it("refuse si owner non enregistré", async function () {
      const { dms, other } = await deploy();
      await expect(
        dms.connect(other).setContactHashes(0, HASH_K1, ethers.ZeroHash, ethers.ZeroHash, NOTIF_0)
      ).to.be.revertedWithCustomError(dms, "NotRegistered");
    });

    it("permet la mise à jour après recréation des parts", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).setContactHashes(0, HASH_K1, ethers.ZeroHash, ethers.ZeroHash, NOTIF_0);

      const HASH_K1_NEW = ethers.keccak256(ethers.toUtf8Bytes("new_share_k1"));
      await dms.connect(owner).setContactHashes(0, HASH_K1_NEW, ethers.ZeroHash, ethers.ZeroHash, NOTIF_0);
      expect(await dms.shareHashes(owner.address, 0, 0)).to.equal(HASH_K1_NEW);
    });
  });

  // ─── checkin() ────────────────────────────────────────────────────────────

  describe("checkin()", function () {
    it("enregistre le check-in et émet l'event", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);

      await time.increase(DAY);
      const tx = await dms.connect(owner).checkin();
      const ts = (await tx.getBlock()).timestamp;

      await expect(tx)
        .to.emit(dms, "CheckinRecorded")
        .withArgs(owner.address, ts, ts + FREQ_30);

      expect(await dms.lastCheckin(owner.address)).to.equal(ts);
    });

    it("refuse si owner non enregistré", async function () {
      const { dms, other } = await deploy();
      await expect(dms.connect(other).checkin())
        .to.be.revertedWithCustomError(dms, "NotRegistered");
    });

    it("refuse si DMS Triggered", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).markTriggered();
      await expect(dms.connect(owner).checkin())
        .to.be.revertedWithCustomError(dms, "AlreadyTriggered");
    });

    it("refuse si DMS en Pause et pause pas encore expirée", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + WEEK + 1000;
      await dms.connect(owner).pause(until);
      await time.increase(DAY); // pause pas encore finie
      await expect(dms.connect(owner).checkin())
        .to.be.revertedWithCustomError(dms, "NotActive");
    });

    it("reprend automatiquement si pause expirée lors du checkin", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + WEEK + 1;
      await dms.connect(owner).pause(until);
      await time.increase(WEEK + 10); // pause expirée

      await expect(dms.connect(owner).checkin())
        .to.emit(dms, "DmsUnpaused")
        .to.emit(dms, "CheckinRecorded");

      expect((await dms.configs(owner.address)).status).to.equal(1); // Active
    });
  });

  // ─── isTriggered() ────────────────────────────────────────────────────────

  describe("isTriggered()", function () {
    it("retourne false si DMS actif mais silence pas encore écoulé", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      await time.increase(MONTH_3 - DAY);
      expect(await dms.isTriggered(owner.address)).to.be.false;
    });

    it("retourne true si silence_duration écoulé", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      await time.increase(MONTH_3 + DAY);
      expect(await dms.isTriggered(owner.address)).to.be.true;
    });

    it("retourne false si DMS Inactive", async function () {
      const { dms, owner } = await deploy();
      expect(await dms.isTriggered(owner.address)).to.be.false;
    });

    it("retourne false si DMS Paused", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_1 });
      const until = (await time.latest()) + MONTH_3 + 1;
      await dms.connect(owner).pause(until);
      await time.increase(MONTH_1 + DAY); // silence dépassé mais en pause
      expect(await dms.isTriggered(owner.address)).to.be.false;
    });

    it("retourne false si DMS déjà Triggered (status changé)", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).markTriggered();
      expect(await dms.isTriggered(owner.address)).to.be.false;
    });

    it("reset après un check-in tardif (avant markTriggered)", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      await time.increase(MONTH_3 + DAY); // silence écoulé
      expect(await dms.isTriggered(owner.address)).to.be.true;

      // L'owner répond — DEC-35 : le backend n'a pas encore appelé markTriggered
      await dms.connect(owner).checkin();
      expect(await dms.isTriggered(owner.address)).to.be.false;
    });
  });

  // ─── secondsUntilTrigger() ────────────────────────────────────────────────

  describe("secondsUntilTrigger()", function () {
    it("retourne la durée restante correcte", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      await time.increase(WEEK);
      const remaining = await dms.secondsUntilTrigger(owner.address);
      expect(remaining).to.be.closeTo(MONTH_3 - WEEK, 5);
    });

    it("retourne 0 si silence écoulé", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      await time.increase(MONTH_3 + DAY);
      expect(await dms.secondsUntilTrigger(owner.address)).to.equal(0);
    });

    it("retourne 0 si non enregistré", async function () {
      const { dms, other } = await deploy();
      expect(await dms.secondsUntilTrigger(other.address)).to.equal(0);
    });
  });

  // ─── pause() / unpause() ──────────────────────────────────────────────────

  describe("pause() / unpause()", function () {
    it("active la pause et passe le status à Paused", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + MONTH_1 + 1;

      await expect(dms.connect(owner).pause(until))
        .to.emit(dms, "DmsPaused")
        .withArgs(owner.address, until);

      expect((await dms.configs(owner.address)).status).to.equal(2); // Paused
      expect((await dms.configs(owner.address)).pausedUntil).to.equal(until);
    });

    it("reset lastCheckin à la mise en pause", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await time.increase(WEEK);
      const until = (await time.latest()) + MONTH_1 + 1;
      await dms.connect(owner).pause(until);
      const ts = await time.latest();
      expect(await dms.lastCheckin(owner.address)).to.equal(ts);
    });

    it("refuse si durée > PAUSE_MAX_SECS (90 jours)", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + MONTH_3 + DAY + 1;
      await expect(dms.connect(owner).pause(until))
        .to.be.revertedWithCustomError(dms, "PauseExceedsMax");
    });

    it("refuse si until dans le passé", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const pastUntil = (await time.latest()) - 1;
      await expect(dms.connect(owner).pause(pastUntil))
        .to.be.revertedWithCustomError(dms, "PauseInPast");
    });

    it("refuse si DMS pas Active", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + WEEK + 1;
      await dms.connect(owner).pause(until);
      // Déjà en pause
      const until2 = (await time.latest()) + WEEK + 2;
      await expect(dms.connect(owner).pause(until2))
        .to.be.revertedWithCustomError(dms, "NotActive");
    });

    it("unpause() reprend tôt et reset lastCheckin", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + WEEK + 1;
      await dms.connect(owner).pause(until);
      await time.increase(DAY);

      await expect(dms.connect(owner).unpause())
        .to.emit(dms, "DmsUnpaused");

      const cfg = await dms.configs(owner.address);
      expect(cfg.status).to.equal(1); // Active
      expect(cfg.pausedUntil).to.equal(0);
    });

    it("unpause() refuse si pas en pause", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await expect(dms.connect(owner).unpause())
        .to.be.revertedWithCustomError(dms, "NotPaused");
    });
  });

  // ─── markTriggered() ──────────────────────────────────────────────────────

  describe("markTriggered()", function () {
    it("marque le DMS comme déclenché", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await time.increase(MONTH_3 + DAY);

      await expect(dms.connect(owner).markTriggered())
        .to.emit(dms, "DmsTriggered");

      expect((await dms.configs(owner.address)).status).to.equal(3); // Triggered
    });

    it("refuse si DMS pas Active", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      const until = (await time.latest()) + WEEK + 1;
      await dms.connect(owner).pause(until);
      await expect(dms.connect(owner).markTriggered())
        .to.be.revertedWithCustomError(dms, "NotActive");
    });

    it("émet le silence écoulé dans l'event", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await time.increase(MONTH_3 + WEEK);
      const tx = await dms.connect(owner).markTriggered();
      const events = await dms.queryFilter(dms.filters.DmsTriggered(), tx.blockNumber);
      expect(events[0].args.silenceSinceCheckin).to.be.gte(MONTH_3 + WEEK);
    });
  });

  // ─── markCompleted() ──────────────────────────────────────────────────────

  describe("markCompleted()", function () {
    it("marque comme terminé après Triggered", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).markTriggered();

      await expect(dms.connect(owner).markCompleted())
        .to.emit(dms, "DmsCompleted");

      expect((await dms.configs(owner.address)).status).to.equal(4); // Completed
    });

    it("refuse si pas Triggered", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await expect(dms.connect(owner).markCompleted())
        .to.be.revertedWithCustomError(dms, "NotActive");
    });
  });

  // ─── deactivate() ─────────────────────────────────────────────────────────

  describe("deactivate()", function () {
    it("passe le status à Inactive", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await expect(dms.connect(owner).deactivate())
        .to.emit(dms, "DmsDeactivated");
      expect((await dms.configs(owner.address)).status).to.equal(0); // Inactive
    });

    it("refuse si déjà Completed", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner);
      await dms.connect(owner).markTriggered();
      await dms.connect(owner).markCompleted();
      await expect(dms.connect(owner).deactivate())
        .to.be.revertedWithCustomError(dms, "AlreadyCompleted");
    });
  });

  // ─── getStatus() ──────────────────────────────────────────────────────────

  describe("getStatus()", function () {
    it("retourne isPastDue=false si dans la fenêtre", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      const s = await dms.getStatus(owner.address);
      expect(s.isPastDue).to.be.false;
    });

    it("retourne isPastDue=true après silence", async function () {
      const { dms, owner } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_3 });
      await time.increase(MONTH_3 + DAY);
      const s = await dms.getStatus(owner.address);
      expect(s.isPastDue).to.be.true;
    });
  });

  // ─── Scénario complet ─────────────────────────────────────────────────────

  describe("Scénario end-to-end (DEC-35)", function () {
    it("cycle de vie complet : register → checkins → pause → trigger → complete", async function () {
      const { dms, owner } = await deploy();

      // 1. Activation de la transmission
      await registerDefault(dms, owner, { silence: MONTH_3, n: 2, m: 2 });
      await dms.connect(owner).setContactHashes(0, HASH_K1, HASH_K2, ethers.ZeroHash, NOTIF_0);
      await dms.connect(owner).setContactHashes(1, HASH_K1, HASH_K3, ethers.ZeroHash, NOTIF_1);

      // 2. Check-ins mensuels normaux
      await time.increase(MONTH_1);
      await dms.connect(owner).checkin();
      await time.increase(MONTH_1);
      await dms.connect(owner).checkin();

      // 3. Mode pause (voyage)
      const pauseUntil = (await time.latest()) + WEEK + 1;
      await dms.connect(owner).pause(pauseUntil);
      expect((await dms.configs(owner.address)).status).to.equal(2); // Paused

      // 4. Fin de pause automatique au prochain checkin
      await time.increase(WEEK + 10);
      await dms.connect(owner).checkin(); // reprend auto
      expect((await dms.configs(owner.address)).status).to.equal(1); // Active

      // 5. L'owner disparaît — 3 relances passent (off-chain), silence écoulé
      await time.increase(MONTH_3 + DAY);
      expect(await dms.isTriggered(owner.address)).to.be.true;

      // 6. Backend appelle markTriggered après 3 relances + silence
      await dms.connect(owner).markTriggered();
      expect((await dms.configs(owner.address)).status).to.equal(3); // Triggered

      // 7. Les contacts confirment (off-chain) → markCompleted
      await dms.connect(owner).markCompleted();
      expect((await dms.configs(owner.address)).status).to.equal(4); // Completed
    });
  });

  // ─── Isolation entre owners ───────────────────────────────────────────────

  describe("Isolation entre owners", function () {
    it("deux owners indépendants ne se voient pas", async function () {
      const { dms, owner, contact1 } = await deploy();
      await registerDefault(dms, owner, { silence: MONTH_1 });
      await registerDefault(dms, contact1, { silence: MONTH_3 });

      // owner en silence, contact1 toujours dans la fenêtre
      await time.increase(MONTH_1 + DAY);
      expect(await dms.isTriggered(owner.address)).to.be.true;
      expect(await dms.isTriggered(contact1.address)).to.be.false;

      // Déclencher owner ne touche pas contact1
      await dms.connect(owner).markTriggered();
      expect((await dms.configs(contact1.address)).status).to.equal(1); // Active
    });
  });
});
