"""E2b-O2: Aliyun SG snapshot / isolate / restore dry paths + receipt schema.

Fully mocked — zero real OpenAPI calls; mutate actions never signed/sent.
Auto Failover OFF / NOT APPROVED. HA_ALIYUN_LIVE_MUTATE stays 0 by default.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence import aliyun_sg as sgm
from fence.aliyun_openapi import (
    MUTATE_ACTIONS_DEFERRED,
    READ_ONLY_ACTIONS,
    AliyunCredentials,
    AliyunEcsRpcClient,
)
from fence.aliyun_sg import AliyunSgPlanError, IsolatePolicy
from fence.config import FenceCfConfig
from fence.factory import build_adapter
from fence.network_fence import AliyunNetworkFenceClient, AliyunNetworkMutateNotImplemented
from fence.preflight import run_preflight

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "aliyun_sg_describe.json"
DESCRIBE = json.loads(FIXTURE.read_text())
PERMS = DESCRIBE["Permissions"]["Permission"]
FAKE_CREDS = AliyunCredentials("LTAI-test-not-real", "secret-test-not-real", source="env_ak")


def _no_network(*_a, **_k):
    raise AssertionError("real network call attempted in O2 unit test")


class _Transport:
    def __init__(self, status=200, payload=None):
        self.status = status
        self.payload = DESCRIBE if payload is None else payload
        self.requests: list[dict] = []

    def __call__(self, url, body, headers, timeout_s):
        form = dict(urllib.parse.parse_qsl(body.decode("utf-8")))
        self.requests.append({"url": url, "form": form})
        return self.status, json.dumps(self.payload)


def _rpc(t):
    return AliyunEcsRpcClient(
        region="cn-hongkong",
        credentials_provider=lambda: FAKE_CREDS,
        transport=t,
        clock=lambda: dt.datetime(2026, 10, 6, tzinfo=dt.timezone.utc),
        nonce=lambda: "n",
    )


def _snap(perms=PERMS, sg="sg-test-fixture-o2"):
    return sgm.build_snapshot(sg_id=sg, region="cn-hongkong", permissions=perms, source="offline_input")


class _NoNetCase(unittest.TestCase):
    def setUp(self):
        for target in (
            "fence.aliyun_openapi.urllib.request.urlopen",
            "fence.aliyun_openapi._default_metadata_fetcher",
        ):
            p = mock.patch(target, side_effect=_no_network)
            p.start()
            self.addCleanup(p.stop)


class TestPolicy(unittest.TestCase):
    def test_parse_port_ranges(self):
        self.assertEqual(sgm.parse_port_ranges("5432, 6432/6433"), ("5432/5432", "6432/6433"))
        self.assertEqual(sgm.parse_port_ranges(""), ())
        for bad in ("abc", "0/1", "10/5", "1/70000"):
            with self.assertRaises(AliyunSgPlanError):
                sgm.parse_port_ranges(bad)

    def test_defaults_pg_isolate_ssh_protected(self):
        p = IsolatePolicy()
        self.assertEqual(p.isolate_port_ranges, ("5432/5432",))
        self.assertEqual(p.protected_port_ranges, ("22/22",))

    def test_isolate_overlapping_protected_refused(self):
        with self.assertRaises(AliyunSgPlanError):
            IsolatePolicy.from_specs("1/1024", "22/22")
        with self.assertRaises(AliyunSgPlanError):
            IsolatePolicy(isolate_port_ranges=())

    def test_classify(self):
        p = IsolatePolicy()
        c = [p.classify(sgm.normalize_rule(r)) for r in PERMS]
        self.assertEqual(
            c, ["keep", "revoke", "revoke", "keep", "blocked_protected_overlap", "keep"]
        )
        self.assertEqual(p.classify({"IpProtocol": "UDP", "PortRange": "5432/5432"}), "keep")
        self.assertEqual(
            p.classify({"IpProtocol": "TCP", "PortRange": "5432/5432", "Policy": "drop"}), "keep"
        )


class TestSnapshotAndPlans(unittest.TestCase):
    def test_snapshot_digest_stable_and_tamper_detected(self):
        a, b = _snap(), _snap(list(reversed(PERMS)))
        self.assertEqual(a["digest"], b["digest"])
        self.assertEqual(a["rule_count"], 6)
        sgm.validate_snapshot(a)
        t = json.loads(json.dumps(a))
        t["rules"][1]["PortRange"] = "5433/5433"
        with self.assertRaises(AliyunSgPlanError):
            sgm.validate_snapshot(t)

    def test_not_captured_snapshot(self):
        s = sgm.build_snapshot(sg_id="sg-x", region="r", permissions=None, source="not_captured")
        self.assertFalse(s["captured"])
        self.assertEqual(s["rules"], [])
        with self.assertRaises(AliyunSgPlanError):
            sgm.build_snapshot(sg_id="sg-x", region="r", permissions=PERMS, source="not_captured")
        with self.assertRaises(AliyunSgPlanError):
            sgm.build_snapshot(sg_id="sg-x", region="r", permissions=[], source="bogus")

    def test_plan_isolate_revokes_only_pg_rules(self):
        plan = sgm.plan_isolate(_snap(), IsolatePolicy())
        self.assertEqual(len(plan["revoke_rules"]), 2)
        self.assertEqual(plan["keep_count"], 3)
        self.assertEqual(len(plan["blocked_protected_overlap"]), 1)
        calls = plan["intended_openapi_calls"]
        self.assertEqual({c["action"] for c in calls}, {"RevokeSecurityGroup"})
        self.assertTrue(all(c["params"]["PortRange"] == "5432/5432" for c in calls))
        self.assertTrue(all(c["params"]["SecurityGroupId"] == "sg-test-fixture-o2" for c in calls))
        self.assertNotIn("_fp", json.dumps(calls))
        self.assertEqual(
            {c["params"].get("SourceCidrIp") or c["params"].get("SourceGroupId") for c in calls},
            {"203.0.113.10/32", "sg-test-peer"},
        )

    def test_plan_restore_mirrors_isolate(self):
        snap = _snap()
        iso = sgm.plan_isolate(snap, IsolatePolicy())
        rst = sgm.plan_restore(snap, iso["revoke_fingerprints"])
        self.assertEqual(rst["restore_fingerprints"], iso["revoke_fingerprints"])
        self.assertEqual(
            [c["params"] for c in rst["intended_openapi_calls"]],
            [c["params"] for c in iso["intended_openapi_calls"]],
        )
        self.assertEqual({c["action"] for c in rst["intended_openapi_calls"]}, {"AuthorizeSecurityGroup"})
        # default fingerprints = recompute isolate plan
        self.assertEqual(sgm.plan_restore(snap)["restore_fingerprints"], iso["revoke_fingerprints"])

    def test_plan_restore_refuses_wrong_snapshot(self):
        iso = sgm.plan_isolate(_snap(), IsolatePolicy())
        other = _snap(PERMS[:1])
        with self.assertRaises(AliyunSgPlanError):
            sgm.plan_restore(other, iso["revoke_fingerprints"])


class TestReceiptSchema(unittest.TestCase):
    def _r(self, **kw):
        snap = _snap()
        base = dict(
            execution_id="e1", region="cn-hongkong", sg_id="sg-test-fixture-o2",
            live=False, live_target="", snapshot=snap,
        )
        base.update(kw)
        return sgm.build_receipt("isolate", plan=sgm.plan_isolate(snap, IsolatePolicy()), **base)

    def test_receipt_shape(self):
        r = self._r()
        self.assertEqual(r["schema"], sgm.RECEIPT_SCHEMA)
        self.assertEqual(r["idempotency_key"], "e1:FENCING_NETWORK:isolate")
        self.assertIs(r["dry_run"], True)
        self.assertIs(r["mutate_issued"], False)
        self.assertEqual(r["auto_fo"], "OFF / NOT APPROVED")
        self.assertEqual(r["revoke_count"], 2)
        self.assertEqual(r["openapi_calls_issued"], [])
        sgm.validate_receipt(r)

    def test_receipt_refuses_mutate_recorded_as_issued(self):
        for action in sorted(MUTATE_ACTIONS_DEFERRED):
            with self.assertRaises(AliyunSgPlanError):
                self._r(openapi_calls_issued=[action])

    def test_validate_rejects_tampered(self):
        for key, val in (
            ("mutate_issued", True),
            ("dry_run", False),
            ("schema", "x/v0"),
            ("auto_fo", "ON"),
            ("idempotency_key", "nope"),
            ("op", "drop_all"),
        ):
            r = self._r()
            r[key] = val
            with self.assertRaises(AliyunSgPlanError, msg=key):
                sgm.validate_receipt(r)
        r = self._r()
        del r["snapshot_digest"]
        with self.assertRaises(AliyunSgPlanError):
            sgm.validate_receipt(r)

    def test_unknown_op(self):
        with self.assertRaises(AliyunSgPlanError):
            sgm.build_receipt(
                "drop_all", execution_id="e", region="r", sg_id="s", live=False,
                live_target="", snapshot=_snap(),
            )


class TestSnapshotFile(unittest.TestCase):
    def test_write_load_roundtrip_0600(self):
        with tempfile.TemporaryDirectory() as d:
            path = sgm.write_snapshot_file(_snap(), d, "exec/../1")
            self.assertTrue(path.startswith(d))
            self.assertNotIn("..", Path(path).name)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertEqual(sgm.load_snapshot_file(path)["digest"], _snap()["digest"])

    def test_refuse_inside_git_and_unset(self):
        repo_dir = str(Path(__file__).resolve().parent)  # inside this git work tree
        self.assertEqual(sgm.check_snapshot_dir(repo_dir), "inside_git_worktree")
        self.assertEqual(sgm.check_snapshot_dir(""), "unset")
        with self.assertRaises(AliyunSgPlanError):
            sgm.write_snapshot_file(_snap(), repo_dir, "e1")


class TestClientDryPaths(_NoNetCase):
    def _client(self, **kw):
        t = _Transport()
        base = dict(region="cn-hongkong", sg_id="sg-test-fixture-o2", openapi=_rpc(t))
        base.update(kw)
        return AliyunNetworkFenceClient(**base), t

    def test_live_false_snapshot_not_captured_zero_calls(self):
        c, t = self._client()
        out = c.snapshot_sg(execution_id="e1")
        self.assertEqual(out["snapshot"]["source"], "not_captured")
        self.assertEqual(out["receipt"]["openapi_calls_issued"], [])
        self.assertEqual(t.requests, [])

    def test_live_false_full_cycle_offline(self):
        c, t = self._client(offline_permissions=PERMS)
        snap = c.snapshot_sg(execution_id="e1")["snapshot"]
        iso = c.isolate(execution_id="e1", snapshot=snap)
        rst = c.restore(execution_id="e1", snapshot=snap, revoke_fingerprints=iso["revoke_fingerprints"])
        self.assertEqual((iso["revoke_count"], rst["restore_count"]), (2, 2))
        self.assertEqual([r["op"] for r in c.receipts], ["snapshot_sg", "isolate", "restore"])
        for r in c.receipts:
            sgm.validate_receipt(r)
            self.assertFalse(r["mutate_issued"])
        self.assertEqual(t.requests, [])

    def test_isolate_without_snapshot_takes_dry_snapshot(self):
        c, t = self._client(offline_permissions=PERMS)
        iso = c.isolate(execution_id="e1")
        self.assertEqual(iso["revoke_count"], 2)
        self.assertEqual(t.requests, [])

    def test_restore_requires_snapshot(self):
        c, _ = self._client()
        with self.assertRaises(AliyunSgPlanError):
            c.restore(execution_id="e1", snapshot=None)

    def test_isolate_old_primary_dry_includes_o2_receipts(self):
        c, t = self._client(offline_permissions=PERMS)
        out = c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertTrue(out["dry_skeleton"])
        self.assertEqual(out["idempotency_key"], "e1:FENCING_NETWORK")
        self.assertEqual(out["o2_receipts"]["isolate"]["revoke_count"], 2)
        self.assertEqual(out["o2_receipts"]["snapshot_sg"]["op"], "snapshot_sg")
        self.assertEqual(t.requests, [])

    def test_snapshot_dir_writes_local_file(self):
        with tempfile.TemporaryDirectory() as d:
            c, _ = self._client(offline_permissions=PERMS, snapshot_dir=d)
            out = c.snapshot_sg(execution_id="e1")
            self.assertTrue(out["receipt"]["snapshot_path_set"])
            self.assertTrue(Path(out["snapshot_path"]).is_file())
            self.assertNotIn(d, json.dumps(out["receipt"]))


class TestClientLiveGates(_NoNetCase):
    def test_ungated_live_refuses_all_ops_before_creds(self):
        for target in ("", "prod", "production", "stage"):
            t = _Transport()
            provider = mock.Mock(side_effect=AssertionError("no creds"))
            rpc = AliyunEcsRpcClient(region="cn-hongkong", credentials_provider=provider, transport=t)
            c = AliyunNetworkFenceClient(
                region="cn-hongkong", sg_id="sg-x", live=True, live_target=target, openapi=rpc
            )
            for fn in (
                lambda: c.snapshot_sg(execution_id="e"),
                lambda: c.isolate(execution_id="e", snapshot=_snap()),
                lambda: c.restore(execution_id="e", snapshot=_snap()),
            ):
                with self.assertRaises(RuntimeError) as cm:
                    fn()
                self.assertNotIsInstance(cm.exception, AliyunNetworkMutateNotImplemented)
                self.assertIn("gates not green", str(cm.exception))
            self.assertEqual(t.requests, [])
            provider.assert_not_called()

    def test_gated_snapshot_readonly_describe(self):
        t = _Transport()
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-test-fixture-o2", live=True,
            live_target="staging", openapi=_rpc(t),
        )
        out = c.snapshot_sg(execution_id="e1")
        self.assertEqual(out["snapshot"]["source"], "openapi_describe")
        self.assertEqual(out["snapshot"]["request_id"], "REQ-FIXTURE-O2")
        self.assertEqual(out["receipt"]["openapi_calls_issued"], ["DescribeSecurityGroupAttribute"])
        self.assertEqual([r["form"]["Action"] for r in t.requests], ["DescribeSecurityGroupAttribute"])

    def test_gated_isolate_plans_then_refuses_no_mutate_sent(self):
        t = _Transport()
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-test-fixture-o2", live=True,
            live_target="staging", openapi=_rpc(t),
        )
        with self.assertRaises(AliyunNetworkMutateNotImplemented) as cm:
            c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertIn("O3", str(cm.exception))
        self.assertEqual(cm.exception.receipt["revoke_count"], 2)
        self.assertFalse(cm.exception.receipt["mutate_issued"])
        self.assertEqual(cm.exception.probe["permission_count"], 6)
        actions = [r["form"]["Action"] for r in t.requests]
        self.assertEqual(actions, ["DescribeSecurityGroupAttribute"])
        self.assertTrue(set(actions) <= READ_ONLY_ACTIONS)

    def test_gated_restore_refuses_no_call(self):
        t = _Transport()
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-test-fixture-o2", live=True,
            live_target="staging", openapi=_rpc(t),
        )
        with self.assertRaises(AliyunNetworkMutateNotImplemented) as cm:
            c.restore(execution_id="e1", snapshot=_snap())
        self.assertEqual(cm.exception.receipt["restore_count"], 2)
        self.assertEqual(t.requests, [])

    def test_mutate_actions_still_outside_allowlist(self):
        self.assertTrue(READ_ONLY_ACTIONS.isdisjoint(MUTATE_ACTIONS_DEFERRED))
        self.assertIn(sgm.ISOLATE_ACTION, MUTATE_ACTIONS_DEFERRED)
        self.assertIn(sgm.RESTORE_ACTION, MUTATE_ACTIONS_DEFERRED)
        self.assertIn(sgm.SNAPSHOT_ACTION, READ_ONLY_ACTIONS)


class TestConfigFactoryPreflightO2(_NoNetCase):
    def _cfg(self, **kw):
        base = dict(
            backend="real", database_url="postgresql://x/y", controller_mode="manual",
            enable_network=True, cloud_provider="aliyun",
            aliyun_region="cn-hongkong", aliyun_sg_id="sg-test",
        )
        base.update(kw)
        return FenceCfConfig(**base)

    def test_env_defaults(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            cfg = FenceCfConfig.from_env()
        self.assertFalse(cfg.aliyun_live_mutate)
        self.assertEqual(cfg.aliyun_isolate_policy().as_dict(),
                         {"isolate_port_ranges": ["5432/5432"], "protected_port_ranges": ["22/22"]})
        self.assertEqual(cfg.aliyun_sg_snapshot_dir, "")

    def test_bad_ports_config_value_error(self):
        with self.assertRaises(ValueError):
            self._cfg(aliyun_isolate_ports="1/65535")  # overlaps protected 22
        env = {"HA_ALIYUN_ISOLATE_PORTS": "garbage"}
        with mock.patch.dict(os.environ, env, clear=True):
            report = run_preflight()
        self.assertFalse(report.ok)
        self.assertEqual(report.checks[0].code, "config_value_error")

    def test_factory_wires_policy_and_dir(self):
        ad = build_adapter(self._cfg(aliyun_isolate_ports="5432,6432", aliyun_sg_snapshot_dir="/var/x"))
        net = ad.network_client
        self.assertEqual(net.isolate_policy.isolate_port_ranges, ("5432/5432", "6432/6432"))
        self.assertEqual(net.snapshot_dir, "/var/x")
        self.assertFalse(net.live)

    def _pf(self, env):
        base = {
            "HA_CONTROLLER_MODE": "manual", "HA_CLOUD_PROVIDER": "aliyun",
            "HA_FENCE_ENABLE_NETWORK": "1", "HA_ALIYUN_REGION": "cn-hongkong",
            "HA_ALIYUN_SG_ID": "sg-test",
        }
        base.update(env)
        with mock.patch.dict(os.environ, base, clear=True):
            return run_preflight()

    def test_preflight_o2_checks_presence_only(self):
        with tempfile.TemporaryDirectory() as d:
            report = self._pf({"HA_ALIYUN_SG_SNAPSHOT_DIR": d})
            codes = {c.code: c for c in report.checks}
            self.assertTrue(report.ok)
            self.assertEqual(codes["aliyun_o2_dry_paths"].level, "ok")
            self.assertEqual(codes["aliyun_sg_snapshot_dir"].level, "ok")
            self.assertEqual(codes["aliyun_cred_presence"].level, "warn")
            self.assertNotIn(d, json.dumps([c.message for c in report.checks]))
            self.assertNotIn(d, json.dumps(report.summary))
            self.assertFalse(report.summary["aliyun_live_mutate"])

    def test_preflight_snapshot_dir_unset_warn_in_git_fail(self):
        r = self._pf({})
        self.assertTrue(r.ok)
        self.assertEqual({c.code: c.level for c in r.checks}["aliyun_sg_snapshot_dir"], "warn")
        r = self._pf({"HA_ALIYUN_SG_SNAPSHOT_DIR": str(Path(__file__).resolve().parent)})
        self.assertFalse(r.ok)
        self.assertEqual({c.code: c.level for c in r.checks}["aliyun_sg_snapshot_dir"], "fail")

    def test_preflight_cred_presence_ram_role(self):
        r = self._pf({"HA_ALIYUN_RAM_ROLE_NAME": "ha-fence-staging-role"})
        lvl = {c.code: c for c in r.checks}["aliyun_cred_presence"]
        self.assertEqual(lvl.level, "ok")
        self.assertNotIn("ha-fence-staging-role", lvl.message)


class TestDryRunCli(_NoNetCase):
    def test_cli_forced_dry_even_if_live_env(self):
        from fence import aliyun_sg_dry_run as cli

        env = {"HA_ALIYUN_LIVE_MUTATE": "1", "HA_ALIYUN_LIVE_TARGET": "staging"}
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(buf), \
                contextlib.redirect_stderr(io.StringIO()):
            rc = cli.main(["--permissions-json", str(FIXTURE), "--execution-id", "e-cli"])
        self.assertEqual(rc, 0)
        out = json.loads(buf.getvalue())
        self.assertTrue(out["forced_dry"])
        self.assertEqual(out["openapi_calls"], 0)
        self.assertEqual(out["receipts"]["isolate"]["revoke_count"], 2)
        self.assertEqual(out["receipts"]["restore"]["restore_count"], 2)
        for r in out["receipts"].values():
            sgm.validate_receipt(r)
            self.assertFalse(r["live"])

    def test_cli_auto_refused(self):
        from fence import aliyun_sg_dry_run as cli

        with mock.patch.dict(os.environ, {"HA_CONTROLLER_MODE": "auto"}, clear=True), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main([]), 2)


if __name__ == "__main__":
    unittest.main()
