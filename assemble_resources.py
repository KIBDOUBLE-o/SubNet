import base64
import json
import os

from resource.resources_bundle_dummy import ResourcesBundleDummy
from resource.web_constructor_dummy import WebConstructorDummy

if __name__ == '__main__':
    def feedback(r_type: str, r_path: str):
        print(f"[ASSEMBLER FEEDBACK] Resource\t{r_type.upper()}\tfrom\t'{r_path}'\tincluded.")

    bundle = ResourcesBundleDummy()

    bundle.set_header({
        "version": "1.0.0"
    })

    bundle.create_category("interface")

    constructor = WebConstructorDummy()

    constructor.include_index(open("resources/ui/master/index.html", encoding="utf-8").read())
    constructor.include_style(open("resources/ui/master/style.css", encoding="utf-8").read())
    constructor.include_script(open("resources/ui/master/script.js", encoding="utf-8").read())
    bundle.put_in_category("interface", "master", json.dumps(constructor.create_dump()).encode("utf-8"))
    feedback("interface", "resources/ui/master")

    constructor.include_index(open("resources/ui/fullscreen/index.html", encoding="utf-8").read())
    constructor.include_style(open("resources/ui/fullscreen/style.css", encoding="utf-8").read())
    constructor.include_script(open("resources/ui/fullscreen/script.js", encoding="utf-8").read())
    bundle.put_in_category("interface", "fullscreen", json.dumps(constructor.create_dump()).encode("utf-8"))
    feedback("interface", "resources/ui/fullscreen")

    bundle.create_category("sounds")

    if os.path.exists("resources/sounds"):
        for item in os.listdir("resources/sounds"):
            sound_path = f"resources/sounds/{item}"
            name = item.split(".")[-2]

            if not item.endswith(".wav"): continue

            with open(sound_path, 'rb') as file:
                bundle.put_in_category("sounds", name, file.read())

            feedback("sound", f"{sound_path} -> '{name}'")

    bundle.create_dump("resources.bundle")
