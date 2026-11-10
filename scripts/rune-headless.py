import json
from pathlib import Path
import struct
import subprocess

root = Path(__file__).resolve().parents[1]
out = root / "build/rune-headless"
out.mkdir(parents=True, exist_ok=True)
tap = out / "tap.json"
tap.write_text(json.dumps({"events": [{"t": 0.1, "type": "tap", "key": "switch"}]}))
knob_x = []
for name, checked, label in [("default", False, "Lights off"), ("tapped", True, "Lights on")]:
    tree_path = out / f"{name}.json"
    png_path = out / f"{name}.png"
    args = ["cargo", "run", "--locked", "--offline", "--", "--at", "1",
            "--tree", str(tree_path), "--snap", str(png_path)]
    if checked:
        args.extend(["--script", str(tap)])
    subprocess.run(args, cwd=root, check=True)
    tree = json.loads(tree_path.read_text())
    assert tree["title"] == tree["accessibility"]["name"] == "Antimatter"
    assert tree["viewport"] == [320.0, 200.0] and tree["scale"] == 2.0
    assert not tree["warnings"] and not tree["animating"]
    switch, = [node for node in tree["accessibility"]["children"] if node.get("key") == "switch"]
    assert switch["role"] == "switch" and switch["name"] == "Lights"
    assert {"click", "focus"} <= set(switch["actions"])
    assert ("checked" if checked else "unchecked") in switch["states"]
    assert ("unchecked" if checked else "checked") not in switch["states"]
    control, = [node for node in tree["elements"] if node.get("key") == "switch"]
    assert control["focusable"] and not control["inert"]
    visible, = [node for node in tree["elements"] if node.get("text") == label]
    assert visible["opacity"] == 1.0 and visible["rect"][2] > 0 and visible["rect"][3] > 0
    assert any(node.get("name") == label for node in tree["accessibility"]["children"])
    knob, = [node for node in tree["elements"] if node.get("key") == "knob"]
    knob_x.append(knob["rect"][0])
    with png_path.open("rb") as png:
        header = png.read(24)
    assert header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR"
    assert struct.unpack(">II", header[16:24]) == (640, 400)
    print(f"PASS {name}: accessible state, visible label, PNG metadata 640x400; {png_path}")
assert abs(knob_x[1] - knob_x[0] - 16.0) < 0.01
print("PASS knob moved 16 points. Visually inspect both PNGs; metadata is not visual proof.")
secure_tree = out / "auth-proof.json"
secure_png = out / "auth-proof.png"
subprocess.run(["cargo", "run", "--locked", "--offline", "--", "--scene", "auth-proof",
                "--at", "1", "--tree", str(secure_tree), "--snap", str(secure_png)], cwd=root, check=True)
secure_json = secure_tree.read_text()
assert "synthetic-pat-do-not-export" not in secure_json
assert "synthetic-password-do-not-export" not in secure_json
secure = json.loads(secure_json)
for key in ["pat", "password"]:
    control, = [node for node in secure["accessibility"]["children"] if node.get("key") == key]
    assert control["role"] == "password-input"
    assert "value" not in control
    element, = [node for node in secure["elements"] if node.get("key") == key]
    assert element["secure"] is True
print(f"PASS synthetic PAT/password tree redaction; visually inspect {secure_png}")

conversation_tree = out / "conversation-proof.json"
conversation_png = out / "conversation-proof.png"
subprocess.run(["cargo", "run", "--locked", "--offline", "--", "--scene", "conversation-proof",
                "--size", "640x640", "--at", "1", "--tree", str(conversation_tree),
                "--snap", str(conversation_png)], cwd=root, check=True)
conversation = json.loads(conversation_tree.read_text())
assert not conversation["warnings"]
assert any(node.get("text") == "Synthetic service conversation" for node in conversation["elements"])
assert any(node.get("key") == "send" for node in conversation["elements"])
assert any(node.get("key") == "draft" for node in conversation["elements"])
print(f"PASS synthetic conversation controls and timeline; visually inspect {conversation_png}")

workspace_inputs = {
    "selected": [{"t": 0.1, "type": "tap", "key": "channel-synthetic-other"}],
    "resized": [{"t": 0.1, "type": "drag", "key": "sidebar-grip", "dx": 64, "dur": 0.3}],
}
workspace = {}
for name, events in [("initial", []), *workspace_inputs.items()]:
    scene = f"workspace-{name}"
    tree_path = out / f"{scene}.json"
    png_path = out / f"{scene}.png"
    args = ["cargo", "run", "--locked", "--offline", "--", "--scene", "workspace-proof",
            "--size", "960x640", "--at", "1", "--tree", str(tree_path), "--snap", str(png_path)]
    if events:
        script = out / f"{scene}-input.json"
        script.write_text(json.dumps({"events": events}))
        args.extend(["--script", str(script)])
    subprocess.run(args, cwd=root, check=True)
    tree = json.loads(tree_path.read_text())
    assert not tree["warnings"]
    elements = tree["elements"]
    workspace[name] = elements
    assert any(e.get("key") == "sidebar-grip" for e in elements)
    for key in ["channel-synthetic-channel", "channel-synthetic-other", "draft", "send", "post-synthetic-post"]:
        if name == "selected" and key == "post-synthetic-post":
            continue
        assert any(e.get("key") == key for e in elements), (name, key)
    with png_path.open("rb") as png:
        header = png.read(24)
    assert header[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", header[16:24]) == (1920, 1280)
    print(f"PASS {scene}: keyed tree, PNG 1920x1280; visually inspect {png_path}")

def node(elements, key):
    return next(e for e in elements if e.get("key") == key)

initial, selected, resized = (workspace[name] for name in ["initial", "selected", "resized"])
assert abs(node(initial, "sidebar-grip")["rect"][0] - 248.0) < 3.0
assert node(resized, "sidebar-grip")["rect"][0] > node(initial, "sidebar-grip")["rect"][0] + 40.0
assert any(e.get("text") == "Synthetic service conversation" for e in initial)
assert not any(e.get("text") == "Synthetic service conversation" for e in selected)
def row_texts(elements, key):
    start = next(i for i, e in enumerate(elements) if e.get("key") == key)
    return [e.get("text") for e in elements[start + 1:start + 4] if e.get("text")]

assert "@2" in row_texts(initial, "channel-synthetic-other")
assert "@2" not in row_texts(initial, "channel-synthetic-channel")
assert node(initial, "draft")["inert"] is False
assert node(initial, "draft")["rect"][3] >= 72
assert node(initial, "draft")["fill"] != "#00000000"
print("PASS synthetic channel selection and sidebar resize, without services or saved state")
for scene, expected_retry in [("workspace-locked-proof", False), ("workspace-retry-proof", True)]:
    tree_path = out / f"{scene}.json"
    png_path = out / f"{scene}.png"
    subprocess.run(["cargo", "run", "--locked", "--offline", "--", "--scene", scene,
                    "--size", "960x640", "--at", "1", "--tree", str(tree_path),
                    "--snap", str(png_path)], cwd=root, check=True)
    tree = json.loads(tree_path.read_text())
    assert not tree["warnings"]
    elements = tree["elements"]
    assert node(elements, "draft")["inert"] and node(elements, "send")["inert"]
    assert node(elements, "channel-synthetic-other")["inert"]
    assert any(e.get("key") == "retry" for e in elements) == expected_retry
    if expected_retry:
        assert any(e.get("text") == "Pending delivery · draft retained" for e in elements)
        assert any(e.get("text") == "Check delivery (no resend)" for e in elements)
    print(f"PASS {scene}: locked controls and retry semantics; visually inspect {png_path}")
for flags in [["--real-account", "--tree", str(out / "forbidden.json")],
              ["--real-account", "--native", "--trace", str(out / "forbidden.trace")]]:
    result = subprocess.run(["cargo", "run", "--locked", "--offline", "--", *flags],
                            cwd=root, capture_output=True, text=True)
    assert result.returncode == 2
assert not (out / "forbidden.json").exists() and not (out / "forbidden.trace").exists()
print("PASS real-account export and native-trace rejection")
