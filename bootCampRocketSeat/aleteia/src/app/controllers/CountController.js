import * as Yup from 'yup';
import Count from '../models/Count';
import User from '../models/User';
import File from '../models/File';
import Demand from '../models/Demand';
import System from '../models/System';
import Notification from '../schemas/Notification';
import CancellationMail from '../jobs/CancellationMail';
import RegistrationMail from '../jobs/RegistrationMail';

import Queue from '../../lib/Queue';

class CountController {
  async index(req, res) {
    const { page = 1 } = req.query; /** paginação */

    const counts = await Count.finddAll({
      where: { canceled_at: null },
      order: ['date'],
      attributes: ['id', 'date'],
      limit: 20,
      offset: (page - 1) * 20,
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar',
              attributes: ['id', 'path', 'url'],
            },
          ],
        },
        {
          model: Demand,
          as: 'demand',
          attributes: ['id', 'name', 'description', 'type'],
          include: [
            {
              model: System,
              as: 'system',
              attributes: [
                'id',
                'name',
                'responsavel',
                'fronteira',
                'linguagem',
              ],
            },
          ],
        },
      ],
    });

    return res.json(counts);
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      date: Yup.date().required(),
      provider_id: Yup.number().required(),
      demand_id: Yup.number().required(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation fails' });
    }

    const { provider_id, date, demand_id } = req.body;

    /**
     * Check if provider_id is a provider
     */
    const isProvider = await User.findOne({
      where: { id: provider_id, provider: true },
    });

    if (!isProvider) {
      return res
        .status(401)
        .json({ error: 'You can only create counts with providers' });
    }

    /**
     * Check if demand_id is a demand (to do)
     */

    const count = await Count.create({
      user_id: req.userId,
      provider_id,
      demand_id,
      date,
    });

    const user = await User.findByPk(req.userId);
    const provider = await User.findOne({
      where: { id: req.userId, provider: true },
    });
    const demand = await Demand.findOne({
      where: { id: demand_id },
    });

    /** Notify Provider (servidor do TRF1) */
    await Notification.create({
      content: `Contagem ${demand.name} de ${user.name} registrada!`,
      user: provider_id,
    });

    await Queue.add(RegistrationMail.key, {
      user,
      provider,
      demand,
      date,
    });

    return res.json(count);
  }

  async delete(req, res) {
    const count = await Count.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email'],
        },
        {
          model: User,
          as: 'user',
          attributes: ['name'],
        },
        {
          model: Demand,
          as: 'demand',
          attributes: ['id', 'name'],
        },
      ],
    });

    if (!count.provider === true) {
      return res.status(401).json({
        error: "You don't have permission to cancel this count!",
      });
    }

    count.canceled_at = new Date();

    await count.save();

    await Queue.add(CancellationMail.key, {
      count,
    });

    return res.json(count);
  }
}
export default new CountController();
