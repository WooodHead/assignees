const gh = require('../helpers/github');
const Organization = require('../models/Organization');
const Repository = require('../models/Repository');

/**
 * List all repositories that can be sync'ed
 */
exports.listRepos = (req, res) => {
  const org = req.params.org;
  const userId = req.user.id;

  Organization.find({ user_id: userId }, (err, organizations) => {
    let findRepos = Promise.resolve(null);

    if (org) {
      findRepos = Repository.find({ user_id: userId, org });
    }

    findRepos.then((repositories) => {
      res.render('repo/list', {
        title: 'Your repositories',
        organizations,
        repositories,
        current_org: org,
      });
    });
  });
};

/**
 * Enable project and install webhook
 */
exports.enable = (req, res) => {
  const { org, repo } = req.params;
  const userId = req.user.id;

  Repository.findOne({
    user_id: userId,
    name: repo,
    org
  }, (err, repository) => {
    if (repository.enabled) {
      req.flash('info', { msg: 'Repository already enabled' });

      return res.redirect(`/repositories/${org}`);
    }

    let createOrEditHook;
    if (repository.github_hook_id) {
      createOrEditHook = gh.auth(req.user).repos.editHook(
        gh.getExistingWebhookConfig(repository.github_hook_id, org, repo, true)
      );
    } else {
      createOrEditHook = gh.auth(req.user).repos.createHook(
        gh.getWebhookConfig(org, repo, true)
      );
    }

    createOrEditHook
      .then((hook) => {
        repository
          .set({
            enabled: true,
            github_hook_id: hook.id,
          })
          .save();

        req.flash('success', { msg: `Project "${repo}" is successfully configured.` });
      })
      .catch((err) => {
        req.flash('errors', { msg: 'An error has occured... Please contact the support.' });
      })
      .then(() => {
        return res.redirect(`/repositories/${org}`);
      })
    ;
  })
};

/**
 * Pause project and disable webhook
 */
exports.pause = (req, res) => {
  const { org, repo } = req.params;
  const userId = req.user.id;

  Repository.findOne({
    user_id: userId,
    name: repo,
    org
  }, (err, repository) => {
    if (!repository.enabled) {
      req.flash('errors', { msg: 'You must enable the project first if you want to disable it.' });

      return res.redirect(`/repositories/${org}`);
    }

    return gh.auth(req.user).repos.editHook(
      gh.getExistingWebhookConfig(repository.github_hook_id, org, repo, false),
      (err, hook) => {
        repository
          .set({ enabled: false })
          .save();

        req.flash('success', { msg: `Project "${repo}" has been paused.` });

        return res.redirect(`/repositories/${org}`);
      }
    );
  });
};

/**
 * Sync organizations
 */
exports.syncOrgs = (req, res) => {
  const userId = req.user.id;

  // 1. remove all orgs
  Organization.remove({ user_id: userId }, (err) => {
    // 2. fetch current orgs
    gh.auth(req.user).users.getOrgs({}, (err, orgs) => {
      organizations = orgs.map(o => {
        return {
          user_id: userId,
          name: o.login,
          description: o.description,
          github_id: o.id,
          github_url: o.url,
          avatar_url: o.avatar_url,
        };
      });

      // 3. persist
      Organization.create(organizations, () => {
        req.flash('success', { msg: 'Organizations successfully synchronized.' });

        return res.redirect('/repositories');
      });
    });
  });
};

/**
 * Sync repositories
 */
exports.syncRepos = (req, res) => {
  const userId = req.user.id;
  const org = req.params.org;

  Repository.find({ user_id: userId, org }, (err, existingRepos) => {
    let fetchRepositories;

    if (org === req.user.github_login) {
      fetchRepositories = gh.auth(req.user).repos.getForUser({ username: org, per_pqge: 50 });
    } else {
      fetchRepositories = gh.auth(req.user).repos.getForOrg({ org, per_page: 50 });
    }

    fetchRepositories
      .then((repos) => {
        const repositories = repos
          .filter(r => existingRepos.find(e => e.github_id === r.id) === undefined)
          .map(r => {
            return {
              user_id: userId,
              org,
              name: r.name,
              github_id: r.id,
              github_url: r.html_url,
              enabled: false,
            };
          })
        ;

        Repository.create(repositories, (err) => {
          req.flash('success', { msg: `"${org}" repositories successfully synchronized.` });

          return res.redirect(`/repositories/${org}`);
        });
      });
  });
};
