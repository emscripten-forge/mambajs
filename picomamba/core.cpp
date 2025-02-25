#include <emscripten/bind.h>
#include <iostream>
#include <vector>
#include <string>
#include "includes/picomamba_core.hpp"

namespace picomamba {

    struct Package {
        char* name;
        char* evr;
        char* build_string;
        int build_number;
    };


emscripten::val transaction_to_js(Transaction* transaction)
{
    Pool* pool = transaction->pool;
    emscripten::val res = emscripten::val::object();
    emscripten::val remove_list = emscripten::val::array();
    emscripten::val install_list = emscripten::val::array();
    emscripten::val ignore_list = emscripten::val::array();

    res.set("remove", remove_list);
    res.set("install", install_list);
    res.set("ignore", ignore_list);

    auto as_tuple = [&pool](Solvable* s) {
        const char* name = pool_id2str(pool, s->name);
        const char* evr = pool_id2str(pool, s->evr);
        const char* build_string = solvable_lookup_str(s, SOLVABLE_BUILDFLAVOR);
        const char* build_version = solvable_lookup_str(s, SOLVABLE_BUILDVERSION);
        const char* filename = solvable_lookup_str(s, SOLVABLE_MEDIAFILE);

        int build_number = 0;
        try {
            build_number = build_version ? std::stoi(build_version) : 0;
        } catch (const std::exception& e) {
            std::cerr << "Error converting build version: " << e.what() << std::endl;
        }

        emscripten::val pkg = emscripten::val::object();
        pkg.set("name", name ? name : "");
        pkg.set("evr", evr ? evr : "");
        pkg.set("build_string", build_string ? build_string : "");
        pkg.set("build_number", build_number);
        pkg.set("repo_name", (s->repo && s->repo->name) ? s->repo->name : "");
        pkg.set("filename", filename ? filename : "");

        return pkg;
    };

    for (int i = 0; i < transaction->steps.count; i++)
    {
        Id p = transaction->steps.elements[i];
        Id ttype = transaction_type(transaction, p, SOLVER_TRANSACTION_SHOW_ALL);
        Solvable* s = pool_id2solvable(transaction->pool, p);
        Solvable* s2;

        switch (ttype)
        {
            case SOLVER_TRANSACTION_DOWNGRADED:
            case SOLVER_TRANSACTION_UPGRADED:
            case SOLVER_TRANSACTION_CHANGED:
            case SOLVER_TRANSACTION_REINSTALLED:
            {
                remove_list.call<void>("push", as_tuple(s));
                s2 = pool_id2solvable(pool, transaction_obs_pkg(transaction, p));
                install_list.call<void>("push", as_tuple(s2));
                break;
            }
            case SOLVER_TRANSACTION_ERASE:
                remove_list.call<void>("push", as_tuple(s));
                break;
            case SOLVER_TRANSACTION_INSTALL:
                install_list.call<void>("push", as_tuple(s));
                break;
            case SOLVER_TRANSACTION_IGNORE:
                ignore_list.call<void>("push", as_tuple(s));
                break;
            default:
                std::cout << "Unhandled transaction case!" << std::endl;
                break;
        }
    }

    return res;
}

emscripten::val solveWrapper(
    PicoMambaCore& self,
    const std::vector<std::string>& match_specs,
    const PicoMambaCore::SolveConfig& config)
{
    emscripten::val res = emscripten::val::object();

    self.solve(
        match_specs.begin(),
        match_specs.end(),
        config,
        [&](Transaction* transaction) {
            res = transaction_to_js(transaction);
        }
    );

    return res;
}

void loadedTest(
    PicoMambaCore& self,
    const std:: string prefix,
    const std::vector<SolvablePackage>& installed_packages)
{

    self.load_installed(
        prefix,
        installed_packages
    );
}

EMSCRIPTEN_BINDINGS(picomamba_bindings) {
    using namespace emscripten;
    value_object<SolvablePackage>("SolvablePackage")
        .field("name", &SolvablePackage::name)
        .field("version", &SolvablePackage::version)
        .field("build_string", &SolvablePackage::build_string)
        .field("build_number", &SolvablePackage::build_number);

    register_vector<std::string>("PackageList");
    register_vector<SolvablePackage>("InstalledPackages");
    class_<PicoMambaCore::SolveConfig>("PicoMambaCoreSolveConfig")
        .constructor<>();

    class_<PicoMambaCore>("PicoMambaCore")
        .constructor<>()
        .function("loadRepodata", &PicoMambaCore::load_repodata_from_file)
        .function("loadInstalled", &loadedTest)
        .function("solve", &solveWrapper);
    }
}